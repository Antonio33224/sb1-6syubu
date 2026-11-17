-- =====================================================================
-- Teste de integração de public.redeem_coupon() NO POSTGRES REAL.
-- Rode no SQL Editor de um projeto de TESTE (não em produção), depois da
-- migração 0006. Tudo acontece dentro de uma transação desfeita no final.
--
-- Cobre: válido, expirado, esgotado, limite por usuário, agendado,
-- inexistente, força bruta e soma de gratuidades.
--
-- Uso duplo SIMULTÂNEO: a função trava a linha do cupom (FOR UPDATE) e o
-- usuário (pg_advisory_xact_lock). Para ver na prática, abra duas abas do
-- SQL Editor e rode, ao mesmo tempo, em cada uma:
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<uuid do usuário>","role":"authenticated"}', true);
--   select public.redeem_coupon('<CODIGO>'); select pg_sleep(5); commit;
-- A segunda aba espera a primeira terminar e recebe already_redeemed.
-- =====================================================================
begin;

-- Dois usuários de teste.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-4000-8000-0000000000a1', 'cupom-a@teste.local', '{"username":"cupom_a"}', '{}', 'authenticated', 'authenticated'),
       ('00000000-0000-4000-8000-0000000000b2', 'cupom-b@teste.local', '{"username":"cupom_b"}', '{}', 'authenticated', 'authenticated');

insert into public.coupons (code, grant_days, max_redemptions, per_user_limit, expires_at, starts_at) values
  ('TESTE-OK', 30, 1, 1, null, null),
  ('TESTE-EXP', 30, null, 1, now() - interval '1 day', null),
  ('TESTE-FUT', 30, null, 1, null, now() + interval '1 day'),
  ('TESTE-DOIS', 7, null, 2, null, null);

create or replace function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

do $$
declare r json;
begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');

  r := public.redeem_coupon(' teste-ok ');
  assert (r->>'ok')::boolean, 'resgate válido falhou: ' || r::text;
  assert public._has_premium('00000000-0000-4000-8000-0000000000a1'), 'gratuidade não liberou o Classify+';

  r := public.redeem_coupon('TESTE-OK');
  assert r->>'reason' = 'already_redeemed', 'limite por usuário: ' || r::text;

  r := public.redeem_coupon('TESTE-EXP');
  assert r->>'reason' = 'expired', 'expirado: ' || r::text;

  r := public.redeem_coupon('TESTE-FUT');
  assert r->>'reason' = 'not_started', 'agendado: ' || r::text;

  -- Soma: 7 + 7 dias depois da gratuidade de 30.
  r := public.redeem_coupon('TESTE-DOIS');
  assert (r->>'ok')::boolean, 'TESTE-DOIS 1: ' || r::text;
  r := public.redeem_coupon('TESTE-DOIS');
  assert (r->>'ok')::boolean, 'TESTE-DOIS 2: ' || r::text;
  assert (select max(ends_at) from public.premium_grants where user_id = '00000000-0000-4000-8000-0000000000a1')
         between now() + interval '43 days' and now() + interval '45 days', 'gratuidades não somaram';
  r := public.redeem_coupon('TESTE-DOIS');
  assert r->>'reason' = 'already_redeemed', 'limite 2 por usuário: ' || r::text;

  -- Outro usuário: o cupom de 1 uso já esgotou.
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000000b2');
  r := public.redeem_coupon('TESTE-OK');
  assert r->>'reason' = 'exhausted', 'esgotado: ' || r::text;
  assert (select redemptions_count from public.coupons where code = 'TESTE-OK') = 1, 'contador passou do limite';

  -- Força bruta: 10 falhas → bloqueado por 1 hora.
  for i in 1..10 loop
    r := public.redeem_coupon('CHUTE-' || i);
  end loop;
  r := public.redeem_coupon('TESTE-DOIS');
  assert r->>'reason' = 'too_many_attempts', 'força bruta: ' || r::text;

  assert exists (select 1 from public.audit_log where action = 'coupon.redeemed'), 'resgate não foi auditado';
  raise notice 'OK: todos os cenários de cupom passaram.';
end $$;

rollback;
