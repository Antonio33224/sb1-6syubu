-- =====================================================================
-- CLASSIFY AI — concierge com Claude (API oficial da Anthropic)
-- Execute depois de 0001, 0002 e 0003. Idempotente.
--
-- Princípios:
--  * A chave da Anthropic fica SOMENTE no servidor (variável ANTHROPIC_API_KEY).
--  * O servidor consulta o banco com o token do próprio usuário (RLS aplicada):
--    a IA só lê o que o usuário já poderia ler e nunca escreve em avaliações,
--    estabelecimentos ou configurações.
--  * Limite de uso por usuário controlado no banco (funciona em várias
--    instâncias serverless da Vercel, ao contrário de contadores em memória).
--  * Conversas salvas são privadas (RLS: apenas o dono lê/apaga).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Limites (ajustáveis pelo admin em platform_settings)
-- ---------------------------------------------------------------------
alter table public.platform_settings add column if not exists ai_hourly_limit int not null default 20 check (ai_hourly_limit between 0 and 1000);
alter table public.platform_settings add column if not exists ai_daily_limit  int not null default 100 check (ai_daily_limit between 0 and 10000);

-- ---------------------------------------------------------------------
-- Registro de uso (cota + controle de tokens)
-- ---------------------------------------------------------------------
create table if not exists public.ai_usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'started' check (status in ('started', 'completed', 'failed')),
  model         text,
  input_tokens  int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_user_idx on public.ai_usage_events (user_id, created_at desc);

-- Reserva uma requisição na cota do usuário logado. Retorna se foi permitida.
create or replace function public.ai_consume_quota()
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  s public.platform_settings;
  last_hour int;
  last_day int;
  ev uuid;
begin
  if uid is null then raise exception 'Entre na sua conta para continuar.'; end if;
  select * into s from public.platform_settings where id = 1;
  -- Serializa requisições simultâneas do mesmo usuário.
  perform pg_advisory_xact_lock(hashtext('classify-ai:' || uid::text));
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into last_hour, last_day
    from public.ai_usage_events where user_id = uid and created_at > now() - interval '1 day';
  if last_hour >= s.ai_hourly_limit then
    return json_build_object('allowed', false, 'reason', 'hourly', 'limit', s.ai_hourly_limit);
  end if;
  if last_day >= s.ai_daily_limit then
    return json_build_object('allowed', false, 'reason', 'daily', 'limit', s.ai_daily_limit);
  end if;
  insert into public.ai_usage_events (user_id) values (uid) returning id into ev;
  return json_build_object('allowed', true, 'event_id', ev,
    'remaining_hour', s.ai_hourly_limit - last_hour - 1, 'remaining_day', s.ai_daily_limit - last_day - 1);
end $$;
revoke execute on function public.ai_consume_quota() from public, anon;
grant execute on function public.ai_consume_quota() to authenticated;

-- Fecha o registro com os tokens efetivamente consumidos (somente do próprio usuário).
create or replace function public.ai_record_usage(p_event uuid, p_status text, p_model text, p_input int, p_output int)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.ai_usage_events
     set status = case when p_status in ('completed', 'failed') then p_status else 'failed' end,
         model = left(p_model, 80),
         input_tokens = greatest(0, coalesce(p_input, 0)),
         output_tokens = greatest(0, coalesce(p_output, 0))
   where id = p_event and user_id = auth.uid() and status = 'started';
end $$;
revoke execute on function public.ai_record_usage(uuid, text, text, int, int) from public, anon;
grant execute on function public.ai_record_usage(uuid, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- Conversas salvas
-- ---------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null default 'Nova conversa' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) between 1 and 20000),
  -- Registros do banco efetivamente consultados e citados na resposta.
  sources         jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and pg_column_size(sources) < 32000),
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

create or replace function public.touch_ai_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.ai_conversations set updated_at = now() where id = new.conversation_id and user_id = new.user_id;
  return null;
end $$;
drop trigger if exists touch_ai_conversation on public.ai_messages;
create trigger touch_ai_conversation after insert on public.ai_messages for each row execute function public.touch_ai_conversation();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.ai_usage_events enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Uso: o próprio usuário e admin leem; escrita apenas pelas funções acima.
drop policy if exists "ai usage read own" on public.ai_usage_events;
create policy "ai usage read own" on public.ai_usage_events for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "ai conversations own" on public.ai_conversations;
create policy "ai conversations own" on public.ai_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "ai messages read own" on public.ai_messages;
create policy "ai messages read own" on public.ai_messages for select to authenticated using (user_id = auth.uid());
drop policy if exists "ai messages insert own" on public.ai_messages;
create policy "ai messages insert own" on public.ai_messages for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
drop policy if exists "ai messages delete own" on public.ai_messages;
create policy "ai messages delete own" on public.ai_messages for delete to authenticated using (user_id = auth.uid());
