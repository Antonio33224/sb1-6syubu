-- =====================================================================
-- CUPONS, GRATUIDADES, AUDITORIA E ALERTAS DE SEGURANÇA
-- Execute depois de 0001–0005. Idempotente (pode rodar de novo).
--
--  * Gratuidade (premium_grants) libera o Classify+ completo: entra em
--    public._has_premium(), que já protege todos os recursos premium.
--  * Cupom = N dias de gratuidade, resgatado por public.redeem_coupon()
--    (atômico: protege contra expirado, esgotado, limite por usuário e
--    uso duplo simultâneo).
--  * A IA de voz passa a exigir acesso Classify+ (assinatura OU gratuidade).
--  * audit_log: trilha de ações administrativas e eventos de segurança;
--    só administradores leem; ninguém altera registros.
--  * admin_settings: configurações PRIVADAS (email do admin padrão para
--    alertas). platform_settings é de leitura pública e por isso NÃO guarda
--    dados pessoais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null, -- null = sistema / servidor
  action      text not null check (char_length(action) between 3 and 80),
  target_type text check (char_length(target_type) <= 40),
  target_id   text check (char_length(target_id) <= 120),
  severity    text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192)
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);

-- Registros de auditoria são imutáveis (nem administradores editam).
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Registros de auditoria não podem ser alterados.';
end $$;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Grava um evento de auditoria. Interna: chamada apenas por outras funções/triggers.
create or replace function public.audit(p_action text, p_target_type text, p_target_id text, p_metadata jsonb default '{}'::jsonb, p_severity text default 'info')
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, target_type, target_id, metadata, severity)
  values (
    (select id from public.profiles where id = auth.uid()),
    left(p_action, 80), left(p_target_type, 40), left(p_target_id, 120),
    coalesce(p_metadata, '{}'::jsonb),
    case when p_severity in ('info', 'warning', 'critical') then p_severity else 'info' end
  );
end $$;
revoke execute on function public.audit(text, text, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Configurações privadas (somente admin)
-- ---------------------------------------------------------------------
create table if not exists public.admin_settings (
  id                           int primary key default 1 check (id = 1),
  admin_alert_email            text check (admin_alert_email is null or (char_length(admin_alert_email) <= 254 and admin_alert_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')),
  login_alert_threshold        int not null default 5  check (login_alert_threshold between 3 and 100),
  login_alert_window_minutes   int not null default 15 check (login_alert_window_minutes between 1 and 1440),
  login_alert_cooldown_minutes int not null default 60 check (login_alert_cooldown_minutes between 5 and 1440),
  last_login_alert_at          timestamptz,
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id) on delete set null
);
insert into public.admin_settings (id) values (1) on conflict do nothing;

create or replace function public.admin_settings_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id := 1;
  new.updated_at := now();
  new.updated_by := coalesce((select id from public.profiles where id = auth.uid()), old.updated_by);
  -- Campos de controle não são editáveis pelo painel.
  if auth.uid() is not null then new.last_login_alert_at := old.last_login_alert_at; end if;
  if (new.admin_alert_email, new.login_alert_threshold, new.login_alert_window_minutes, new.login_alert_cooldown_minutes)
     is distinct from (old.admin_alert_email, old.login_alert_threshold, old.login_alert_window_minutes, old.login_alert_cooldown_minutes) then
    perform public.audit('security_settings.updated', 'admin_settings', '1', jsonb_build_object(
      'alert_email_changed', new.admin_alert_email is distinct from old.admin_alert_email,
      'threshold', new.login_alert_threshold,
      'window_minutes', new.login_alert_window_minutes,
      'cooldown_minutes', new.login_alert_cooldown_minutes), 'warning');
  end if;
  return new;
end $$;
drop trigger if exists admin_settings_touch on public.admin_settings;
create trigger admin_settings_touch before update on public.admin_settings
  for each row execute function public.admin_settings_touch();

-- ---------------------------------------------------------------------
-- Cupons e gratuidades
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null check (code ~ '^[A-Z0-9-]{4,32}$'),
  description       text not null default '' check (char_length(description) <= 200),
  grant_days        int not null check (grant_days between 1 and 365),
  max_redemptions   int check (max_redemptions is null or max_redemptions between 1 and 1000000),
  per_user_limit    int not null default 1 check (per_user_limit between 1 and 10),
  redemptions_count int not null default 0 check (redemptions_count >= 0),
  starts_at         timestamptz,
  expires_at        timestamptz,
  active            boolean not null default true,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (expires_at is null or starts_at is null or expires_at > starts_at)
);
create unique index if not exists coupons_code_key on public.coupons (code);

create table if not exists public.premium_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  source        text not null check (source in ('coupon', 'admin')),
  coupon_id     uuid references public.coupons (id) on delete set null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  reason        text not null default '' check (char_length(reason) <= 300),
  granted_by    uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles (id) on delete set null,
  revoke_reason text check (char_length(revoke_reason) <= 300),
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists premium_grants_user_idx on public.premium_grants (user_id, ends_at desc);

create table if not exists public.coupon_redemptions (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  grant_id   uuid references public.premium_grants (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx on public.coupon_redemptions (coupon_id, user_id);
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id, created_at desc);

-- Tentativas de resgate (limita força bruta de códigos).
create table if not exists public.coupon_redeem_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists coupon_redeem_attempts_idx on public.coupon_redeem_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Acesso premium = assinatura vigente OU gratuidade ativa (espelha
-- src/lib/plus/subscription.ts → resolveAccess)
-- ---------------------------------------------------------------------
create or replace function public._has_premium(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('trialing', 'active', 'canceled')
      and coalesce(case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end) else s.current_period_end end, '-infinity') > now()
  ) or exists (
    select 1 from public.premium_grants g
    where g.user_id = p_user and g.revoked_at is null and g.starts_at <= now() and g.ends_at > now()
  );
$$;
revoke execute on function public._has_premium(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Resgate de cupom (usuário logado)
-- ---------------------------------------------------------------------
create or replace function public.redeem_coupon(p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  c public.coupons;
  used int;
  recent_fail int;
  base timestamptz;
  g public.premium_grants;
begin
  if uid is null then return json_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  -- Serializa os resgates do MESMO usuário (dois cliques / duas abas ao mesmo tempo).
  perform pg_advisory_xact_lock(hashtext('classify-coupon-user:' || uid::text));

  select count(*) into recent_fail from public.coupon_redeem_attempts
   where user_id = uid and not success and created_at > now() - interval '1 hour';
  if recent_fail >= 10 then return json_build_object('ok', false, 'reason', 'too_many_attempts'); end if;

  if v_code !~ '^[A-Z0-9-]{4,32}$' then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Trava a linha do cupom: resgates simultâneos de usuários diferentes
  -- esperam aqui, então o contador nunca passa de max_redemptions.
  select * into c from public.coupons where code = v_code for update;
  if not found or not c.active then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'invalid'); -- não revela se existe e está inativo
  end if;
  if c.starts_at is not null and c.starts_at > now() then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'not_started');
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_redemptions is not null and c.redemptions_count >= c.max_redemptions then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'exhausted');
  end if;
  select count(*) into used from public.coupon_redemptions where coupon_id = c.id and user_id = uid;
  if used >= c.per_user_limit then
    insert into public.coupon_redeem_attempts (user_id, success) values (uid, false);
    return json_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  -- Gratuidades se somam: a nova começa quando a última ativa termina.
  select max(ends_at) into base from public.premium_grants where user_id = uid and revoked_at is null and ends_at > now();
  base := greatest(now(), coalesce(base, now()));
  insert into public.premium_grants (user_id, source, coupon_id, starts_at, ends_at, reason)
       values (uid, 'coupon', c.id, base, base + make_interval(days => c.grant_days), 'Cupom ' || c.code)
    returning * into g;
  insert into public.coupon_redemptions (coupon_id, user_id, grant_id) values (c.id, uid, g.id);
  update public.coupons set redemptions_count = redemptions_count + 1, updated_at = now() where id = c.id;
  insert into public.coupon_redeem_attempts (user_id, success) values (uid, true);
  perform public.audit('coupon.redeemed', 'coupon', c.id::text, jsonb_build_object('code', c.code, 'grant_id', g.id, 'days', c.grant_days));

  return json_build_object('ok', true, 'grant_id', g.id, 'starts_at', g.starts_at, 'ends_at', g.ends_at, 'days', c.grant_days);
end $$;
revoke execute on function public.redeem_coupon(text) from public, anon;
grant execute on function public.redeem_coupon(text) to authenticated;

-- ---------------------------------------------------------------------
-- Funções administrativas (todas verificam is_admin() e auditam)
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_coupon(
  p_id uuid, p_code text, p_description text, p_grant_days int, p_max_redemptions int,
  p_per_user_limit int, p_starts_at timestamptz, p_expires_at timestamptz, p_active boolean
) returns public.coupons language plpgsql volatile security definer set search_path = public as $$
declare
  c public.coupons;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if p_id is null then
    insert into public.coupons (code, description, grant_days, max_redemptions, per_user_limit, starts_at, expires_at, active, created_by)
         values (v_code, coalesce(p_description, ''), p_grant_days, p_max_redemptions, coalesce(p_per_user_limit, 1), p_starts_at, p_expires_at, coalesce(p_active, true), auth.uid())
      returning * into c;
    perform public.audit('coupon.created', 'coupon', c.id::text, jsonb_build_object('code', c.code, 'grant_days', c.grant_days, 'max_redemptions', c.max_redemptions, 'per_user_limit', c.per_user_limit, 'expires_at', c.expires_at));
  else
    update public.coupons set
      code = v_code, description = coalesce(p_description, ''), grant_days = p_grant_days,
      max_redemptions = p_max_redemptions, per_user_limit = coalesce(p_per_user_limit, 1),
      starts_at = p_starts_at, expires_at = p_expires_at, active = coalesce(p_active, true), updated_at = now()
     where id = p_id
    returning * into c;
    if not found then raise exception 'Cupom não encontrado.'; end if;
    perform public.audit('coupon.updated', 'coupon', c.id::text, jsonb_build_object('code', c.code, 'grant_days', c.grant_days, 'max_redemptions', c.max_redemptions, 'per_user_limit', c.per_user_limit, 'expires_at', c.expires_at, 'active', c.active));
  end if;
  return c;
exception when unique_violation then
  raise exception 'Já existe um cupom com este código.';
end $$;
revoke execute on function public.admin_upsert_coupon(uuid, text, text, int, int, int, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.admin_upsert_coupon(uuid, text, text, int, int, int, timestamptz, timestamptz, boolean) to authenticated;

create or replace function public.admin_set_coupon_active(p_id uuid, p_active boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  update public.coupons set active = p_active, updated_at = now() where id = p_id returning code into v_code;
  if not found then raise exception 'Cupom não encontrado.'; end if;
  perform public.audit(case when p_active then 'coupon.activated' else 'coupon.deactivated' end, 'coupon', p_id::text, jsonb_build_object('code', v_code));
end $$;
revoke execute on function public.admin_set_coupon_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_coupon_active(uuid, boolean) to authenticated;

create or replace function public.admin_grant_premium(p_user uuid, p_days int, p_reason text)
returns public.premium_grants language plpgsql volatile security definer set search_path = public as $$
declare
  base timestamptz;
  g public.premium_grants;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if p_days is null or p_days not between 1 and 3650 then raise exception 'Informe entre 1 e 3650 dias.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Usuário não encontrado.'; end if;
  perform pg_advisory_xact_lock(hashtext('classify-coupon-user:' || p_user::text));
  select max(ends_at) into base from public.premium_grants where user_id = p_user and revoked_at is null and ends_at > now();
  base := greatest(now(), coalesce(base, now()));
  insert into public.premium_grants (user_id, source, starts_at, ends_at, reason, granted_by)
       values (p_user, 'admin', base, base + make_interval(days => p_days), left(coalesce(p_reason, ''), 300), auth.uid())
    returning * into g;
  perform public.audit('grant.created', 'profile', p_user::text, jsonb_build_object('grant_id', g.id, 'days', p_days, 'ends_at', g.ends_at, 'reason', g.reason), 'warning');
  return g;
end $$;
revoke execute on function public.admin_grant_premium(uuid, int, text) from public, anon;
grant execute on function public.admin_grant_premium(uuid, int, text) to authenticated;

create or replace function public.admin_revoke_grant(p_grant uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  update public.premium_grants
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(coalesce(p_reason, ''), 300)
   where id = p_grant and revoked_at is null
  returning user_id into v_user;
  if not found then raise exception 'Gratuidade não encontrada ou já revogada.'; end if;
  perform public.audit('grant.revoked', 'profile', v_user::text, jsonb_build_object('grant_id', p_grant, 'reason', left(coalesce(p_reason, ''), 300)), 'warning');
end $$;
revoke execute on function public.admin_revoke_grant(uuid, text) from public, anon;
grant execute on function public.admin_revoke_grant(uuid, text) to authenticated;

-- Busca de usuários para conceder gratuidade (inclui e-mail: só admin).
create or replace function public.admin_find_users(p_query text)
returns table (id uuid, username text, full_name text, email text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
declare q text := lower(trim(coalesce(p_query, '')));
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select p.id, p.username, p.full_name, u.email::text, p.role
      from public.profiles p join auth.users u on u.id = p.id
     where p.username ilike '%' || q || '%' or lower(u.email) like '%' || q || '%' or lower(p.full_name) like '%' || q || '%'
     order by p.username
     limit 20;
end $$;
revoke execute on function public.admin_find_users(text) from public, anon;
grant execute on function public.admin_find_users(text) to authenticated;

-- ---------------------------------------------------------------------
-- Falhas de login e alertas por e-mail (chamada SOMENTE pelo servidor,
-- com service_role, a partir de /api/auth/login-failed)
-- ---------------------------------------------------------------------
create table if not exists public.auth_failures (
  id         bigint generated always as identity primary key,
  email      text not null check (char_length(email) <= 254),
  ip_hash    text check (char_length(ip_hash) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists auth_failures_email_idx on public.auth_failures (email, created_at desc);
create index if not exists auth_failures_ip_idx on public.auth_failures (ip_hash, created_at desc);
create index if not exists auth_failures_created_idx on public.auth_failures (created_at);

create or replace function public.record_login_failure(p_email text, p_ip_hash text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  s public.admin_settings;
  v_email text := lower(left(trim(coalesce(p_email, '')), 254));
  email_count int;
  ip_count int;
  pair_count int;
  crossed boolean;
  should_alert boolean := false;
begin
  select * into s from public.admin_settings where id = 1 for update; -- serializa o cooldown do alerta
  if not found then
    insert into public.admin_settings (id) values (1) on conflict do nothing;
    select * into s from public.admin_settings where id = 1 for update;
  end if;

  -- Proteção contra inundação do próprio registro (o endpoint é público).
  select count(*) into ip_count from public.auth_failures
   where ip_hash = p_ip_hash and created_at > now() - make_interval(mins => s.login_alert_window_minutes);
  if ip_count >= 200 then
    return json_build_object('recorded', false, 'too_many', true, 'should_alert', false);
  end if;

  insert into public.auth_failures (email, ip_hash) values (v_email, p_ip_hash);
  delete from public.auth_failures where created_at < now() - interval '30 days';

  select count(*) into email_count from public.auth_failures
   where email = v_email and created_at > now() - make_interval(mins => s.login_alert_window_minutes);
  select count(*) filter (where email = v_email), count(*) into pair_count, ip_count from public.auth_failures
   where ip_hash = p_ip_hash and created_at > now() - make_interval(mins => s.login_alert_window_minutes);

  crossed := email_count >= s.login_alert_threshold or ip_count >= s.login_alert_threshold * 3;
  if crossed and (s.last_login_alert_at is null or s.last_login_alert_at < now() - make_interval(mins => s.login_alert_cooldown_minutes)) then
    update public.admin_settings set last_login_alert_at = now() where id = 1;
    perform public.audit('auth.login_failures_alert', 'email', v_email,
      jsonb_build_object('email_failures', email_count, 'ip_failures', ip_count, 'window_minutes', s.login_alert_window_minutes,
                         'email_sent', s.admin_alert_email is not null), 'critical');
    should_alert := s.admin_alert_email is not null;
  end if;

  return json_build_object(
    'recorded', true,
    'email_failures', email_count,
    'ip_failures', ip_count,
    'threshold', s.login_alert_threshold,
    'window_minutes', s.login_alert_window_minutes,
    'too_many', pair_count >= s.login_alert_threshold,
    'should_alert', should_alert,
    'alert_email', case when should_alert then s.admin_alert_email else null end
  );
end $$;
revoke execute on function public.record_login_failure(text, text) from public, anon, authenticated;
grant execute on function public.record_login_failure(text, text) to service_role;

-- E-mail de teste disparado pelo painel: o servidor confirma que é admin
-- e lê o destino com o token do próprio admin.
create or replace function public.admin_security_test_logged()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  perform public.audit('security_settings.test_email', 'admin_settings', '1', '{}'::jsonb);
end $$;
revoke execute on function public.admin_security_test_logged() from public, anon;
grant execute on function public.admin_security_test_logged() to authenticated;

-- ---------------------------------------------------------------------
-- Triggers de auditoria em ações administrativas existentes
-- ---------------------------------------------------------------------

-- Papel de usuário: audita e impede remover o último administrador.
-- AFTER UPDATE: enxerga o valor final (depois de protect_profile_fields).
create or replace function public.audit_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if old.role = 'admin' and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
      raise exception 'Não é possível remover o último administrador.';
    end if;
    perform public.audit('user.role_changed', 'profile', new.id::text, jsonb_build_object('from', old.role, 'to', new.role, 'username', new.username), 'critical');
  end if;
  return null;
end $$;
drop trigger if exists audit_profile_role on public.profiles;
create trigger audit_profile_role after update of role on public.profiles
  for each row execute function public.audit_profile_role();

create or replace function public.audit_platform_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare changed text[];
begin
  select coalesce(array_agg(n.key), '{}') into changed
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
   where n.value is distinct from o.value;
  if cardinality(changed) > 0 then
    perform public.audit('settings.updated', 'platform_settings', '1', jsonb_build_object('fields', changed));
  end if;
  return null;
end $$;
drop trigger if exists audit_platform_settings on public.platform_settings;
create trigger audit_platform_settings after update on public.platform_settings
  for each row execute function public.audit_platform_settings();

create or replace function public.audit_catalog_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not old.is_demo then
    perform public.audit(tg_table_name || '.deleted', tg_table_name, old.id::text, jsonb_build_object('name', old.name, 'slug', old.slug), 'warning');
  end if;
  return null;
end $$;
drop trigger if exists audit_venue_delete on public.venues;
create trigger audit_venue_delete after delete on public.venues for each row execute function public.audit_catalog_delete();
drop trigger if exists audit_event_delete on public.events;
create trigger audit_event_delete after delete on public.events for each row execute function public.audit_catalog_delete();

-- Moderação: alteração de status por quem não é o autor.
create or replace function public.audit_review_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and auth.uid() <> old.user_id then
    perform public.audit('review.moderated', 'venue_review', new.id::text, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end $$;
drop trigger if exists audit_review_moderation on public.venue_reviews;
create trigger audit_review_moderation after update of status on public.venue_reviews
  for each row execute function public.audit_review_moderation();

-- ---------------------------------------------------------------------
-- IA de voz: exige Classify+ (assinatura OU gratuidade)
-- ---------------------------------------------------------------------
create or replace function public.voice_start_session(p_model text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.platform_settings;
  last_hour int;
  last_day int;
  sess public.voice_sessions;
begin
  if uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if not public._has_premium(uid) then
    return json_build_object('allowed', false, 'reason', 'subscription_required');
  end if;
  select * into s from public.platform_settings where id = 1;
  perform pg_advisory_xact_lock(hashtext('classify-voice:' || uid::text));
  select count(*) filter (where started_at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
    from public.voice_sessions
   where user_id = uid and status <> 'failed' and started_at > now() - interval '1 day';
  if last_hour >= s.voice_hourly_sessions then
    return json_build_object('allowed', false, 'reason', 'hourly', 'limit', s.voice_hourly_sessions);
  end if;
  if last_day >= s.voice_daily_sessions then
    return json_build_object('allowed', false, 'reason', 'daily', 'limit', s.voice_daily_sessions);
  end if;
  update public.voice_sessions set status = 'ended', ended_at = now() where user_id = uid and status = 'active';
  insert into public.voice_sessions (user_id, model, expires_at)
       values (uid, left(p_model, 80), now() + make_interval(secs => s.voice_max_session_seconds))
    returning * into sess;
  return json_build_object('allowed', true, 'session_id', sess.id, 'expires_at', sess.expires_at, 'max_seconds', s.voice_max_session_seconds);
end $$;
revoke execute on function public.voice_start_session(text) from public, anon;
grant execute on function public.voice_start_session(text) to authenticated;

create or replace function public.voice_register_tool_call(p_session uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.platform_settings;
  sess public.voice_sessions;
begin
  if uid is null then return json_build_object('allowed', false, 'reason', 'unauthenticated'); end if;
  if not public._has_premium(uid) then return json_build_object('allowed', false, 'reason', 'subscription_required'); end if;
  select * into s from public.platform_settings where id = 1;
  select * into sess from public.voice_sessions where id = p_session and user_id = uid for update;
  if not found then return json_build_object('allowed', false, 'reason', 'not_found'); end if;
  if sess.status <> 'active' then return json_build_object('allowed', false, 'reason', 'ended'); end if;
  if sess.expires_at <= now() then
    update public.voice_sessions set status = 'ended', ended_at = now() where id = sess.id;
    return json_build_object('allowed', false, 'reason', 'expired');
  end if;
  if sess.tool_calls >= s.voice_max_tool_calls then
    return json_build_object('allowed', false, 'reason', 'tool_limit', 'limit', s.voice_max_tool_calls);
  end if;
  update public.voice_sessions set tool_calls = tool_calls + 1 where id = sess.id;
  return json_build_object('allowed', true);
end $$;
revoke execute on function public.voice_register_tool_call(uuid) from public, anon;
grant execute on function public.voice_register_tool_call(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.audit_log enable row level security;
alter table public.admin_settings enable row level security;
alter table public.coupons enable row level security;
alter table public.premium_grants enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.coupon_redeem_attempts enable row level security;
alter table public.auth_failures enable row level security;

-- audit_log: só admin lê; escrita apenas por public.audit() (security definer).
drop policy if exists "audit admin read" on public.audit_log;
create policy "audit admin read" on public.audit_log for select to authenticated using (public.is_admin());

-- admin_settings: só admin lê e altera (não há insert/delete).
drop policy if exists "admin settings read" on public.admin_settings;
create policy "admin settings read" on public.admin_settings for select to authenticated using (public.is_admin());
drop policy if exists "admin settings update" on public.admin_settings;
create policy "admin settings update" on public.admin_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- coupons: só admin lê; escrita apenas pelas funções admin_*.
drop policy if exists "coupons admin read" on public.coupons;
create policy "coupons admin read" on public.coupons for select to authenticated using (public.is_admin());

-- premium_grants / coupon_redemptions: o próprio usuário e admin leem; escrita só pelas funções.
drop policy if exists "grants read own" on public.premium_grants;
create policy "grants read own" on public.premium_grants for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "redemptions read own" on public.coupon_redemptions;
create policy "redemptions read own" on public.coupon_redemptions for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- coupon_redeem_attempts / auth_failures: sem políticas = inacessíveis pela API
-- (somente funções security definer e service_role).

revoke all on public.audit_log, public.auth_failures, public.coupon_redeem_attempts from anon;
revoke insert, update, delete on public.audit_log from authenticated;
