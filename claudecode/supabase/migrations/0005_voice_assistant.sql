-- =====================================================================
-- CONCIERGE DE VOZ — OpenAI Realtime (substitui o Classify AI em texto)
-- Execute depois de 0001–0004. Idempotente.
--
--  * OPENAI_API_KEY fica SOMENTE no servidor; o navegador recebe um token efêmero.
--  * Rate limit por usuário e limite de duração/tool calls por sessão ficam no
--    banco (valem para todas as instâncias serverless da Vercel).
--  * As transcrições salvas reutilizam ai_conversations/ai_messages (0004),
--    privadas por RLS e apagáveis pelo usuário. Salvar é opt-in no cliente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Limites (ajustáveis pelo admin em platform_settings)
-- ---------------------------------------------------------------------
alter table public.platform_settings add column if not exists voice_hourly_sessions     int not null default 6   check (voice_hourly_sessions between 0 and 100);
alter table public.platform_settings add column if not exists voice_daily_sessions      int not null default 20  check (voice_daily_sessions between 0 and 1000);
alter table public.platform_settings add column if not exists voice_max_session_seconds int not null default 600 check (voice_max_session_seconds between 60 and 3600);
alter table public.platform_settings add column if not exists voice_max_tool_calls      int not null default 60  check (voice_max_tool_calls between 1 and 500);

-- ---------------------------------------------------------------------
-- Sessões de voz
-- ---------------------------------------------------------------------
create table if not exists public.voice_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'ended', 'failed')),
  model       text,
  tool_calls  int not null default 0 check (tool_calls >= 0),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz
);
create index if not exists voice_sessions_user_idx on public.voice_sessions (user_id, started_at desc);

-- Abre uma sessão para o usuário logado, respeitando o rate limit.
-- Sessões 'failed' (erro ao gerar o token na OpenAI) não contam no limite.
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
  -- Uma sessão ativa por vez: novas sessões encerram as anteriores.
  update public.voice_sessions set status = 'ended', ended_at = now() where user_id = uid and status = 'active';
  insert into public.voice_sessions (user_id, model, expires_at)
       values (uid, left(p_model, 80), now() + make_interval(secs => s.voice_max_session_seconds))
    returning * into sess;
  return json_build_object('allowed', true, 'session_id', sess.id, 'expires_at', sess.expires_at, 'max_seconds', s.voice_max_session_seconds);
end $$;
revoke execute on function public.voice_start_session(text) from public, anon;
grant execute on function public.voice_start_session(text) to authenticated;

-- Encerra (ended) ou marca como falha (failed) uma sessão do próprio usuário.
create or replace function public.voice_end_session(p_session uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.voice_sessions
     set status = case when p_status = 'failed' then 'failed' else 'ended' end, ended_at = now()
   where id = p_session and user_id = auth.uid() and status = 'active';
end $$;
revoke execute on function public.voice_end_session(uuid, text) from public, anon;
grant execute on function public.voice_end_session(uuid, text) to authenticated;

-- Registra uma tool call. Recusa se a sessão não é do usuário, expirou,
-- foi encerrada ou atingiu o teto de consultas.
create or replace function public.voice_register_tool_call(p_session uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.platform_settings;
  sess public.voice_sessions;
begin
  if uid is null then return json_build_object('allowed', false, 'reason', 'unauthenticated'); end if;
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
-- Conversas salvas: marca a origem (texto legado ou voz)
-- ---------------------------------------------------------------------
alter table public.ai_conversations add column if not exists channel text not null default 'text' check (channel in ('text', 'voice'));

-- ---------------------------------------------------------------------
-- Row Level Security: leitura do próprio usuário (e admin); escrita só pelas funções.
-- ---------------------------------------------------------------------
alter table public.voice_sessions enable row level security;
drop policy if exists "voice sessions read own" on public.voice_sessions;
create policy "voice sessions read own" on public.voice_sessions for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- As funções de cota do Classify AI em texto (0004) ficam sem uso.
revoke execute on function public.ai_consume_quota() from authenticated;
revoke execute on function public.ai_record_usage(uuid, text, text, int, int) from authenticated;
