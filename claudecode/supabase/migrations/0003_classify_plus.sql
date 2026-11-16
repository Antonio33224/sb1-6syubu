-- =====================================================================
-- CLASSIFY+ — assinatura premium
-- Execute depois de 0001 e 0002. Idempotente (pode ser reexecutado).
--
-- Princípios:
--  * Avaliações públicas NÃO mudam: todos os usuários têm o mesmo peso.
--  * O status de uma assinatura só é alterado pelo servidor (webhook com
--    service_role). O navegador nunca grava em subscriptions/payments.
--  * Nenhum dado de cartão é armazenado aqui.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estabelecimentos: dados para filtros avançados + curadoria INDICADO
-- (NULL / vazio = não informado; a interface nunca estima esses valores)
-- ---------------------------------------------------------------------
alter table public.venues add column if not exists audience_tags text[] not null default '{}';
alter table public.venues add column if not exists capacity int check (capacity is null or capacity > 0);
alter table public.venues add column if not exists opens_at text check (opens_at is null or opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.venues add column if not exists closes_at text check (closes_at is null or closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.venues add column if not exists is_indicated boolean not null default false;

-- Casas demonstrativas indicadas (somente dados demo; curadoria real é feita no painel)
update public.venues set is_indicated = true where is_demo and slug in ('paradise-club', 'rooftop-360', 'estacao-22');

-- Normalização de nomes de DJs/artistas — espelha normalizeName() em src/lib/plus/alerts.ts
create or replace function public.normalize_name(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id          text primary key check (id in ('monthly', 'annual')),
  name        text not null,
  price_cents int not null check (price_cents > 0),
  currency    text not null default 'BRL',
  interval    text not null check (interval in ('month', 'year')),
  trial_days  int not null default 0 check (trial_days between 0 and 30),
  active      boolean not null default true
);
insert into public.subscription_plans (id, name, price_cents, interval, trial_days) values
  ('monthly', 'Classify+ Mensal', 1290, 'month', 7),
  ('annual', 'Classify+ Anual', 10900, 'year', 0)
on conflict (id) do update set name = excluded.name, price_cents = excluded.price_cents, interval = excluded.interval, trial_days = excluded.trial_days;

-- ---------------------------------------------------------------------
-- Assinaturas
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles (id) on delete cascade,
  plan_id                  text not null references public.subscription_plans (id),
  status                   text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'incomplete')),
  provider                 text not null check (provider in ('stripe', 'mercadopago', 'demo')),
  provider_customer_id     text,
  provider_subscription_id text unique,
  trial_start              timestamptz,
  trial_end                timestamptz,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  ended_at                 timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, created_at desc);
create index if not exists subscriptions_customer_idx on public.subscriptions (provider_customer_id);

-- Pagamentos confirmados/recusados pelo gateway (valores REALMENTE recebidos)
create table if not exists public.subscription_payments (
  id                  uuid primary key default gen_random_uuid(),
  subscription_id     uuid references public.subscriptions (id) on delete set null,
  user_id             uuid references public.profiles (id) on delete set null,
  provider_invoice_id text unique,
  amount_cents        int not null check (amount_cents >= 0),
  currency            text not null default 'BRL',
  status              text not null check (status in ('paid', 'failed', 'refunded')),
  failure_reason      text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists payments_user_idx on public.subscription_payments (user_id, created_at desc);

-- Idempotência dos webhooks (cada evento do gateway é processado uma única vez)
create table if not exists public.billing_webhook_events (
  id           text primary key,
  provider     text not null,
  type         text not null,
  processed_at timestamptz not null default now()
);

-- Acesso premium vigente. Interna: não exposta a clientes (ver has_premium()).
create or replace function public._has_premium(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('trialing', 'active', 'canceled')
      and coalesce(case when s.status = 'trialing' then coalesce(s.trial_end, s.current_period_end) else s.current_period_end end, '-infinity') > now()
  );
$$;
revoke execute on function public._has_premium(uuid) from public, anon, authenticated;

-- Para o próprio usuário logado.
create or replace function public.has_premium()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public._has_premium(auth.uid());
$$;

-- Teste grátis: somente quem nunca iniciou um teste com esta conta.
create or replace function public.trial_eligible(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.subscriptions where user_id = p_user and trial_start is not null);
$$;
revoke execute on function public.trial_eligible(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Preferências (Meu Ranking, alertas, filtros salvos)
-- ---------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  ranking_presets  jsonb not null default '[]'::jsonb check (jsonb_typeof(ranking_presets) = 'array' and jsonb_array_length(ranking_presets) <= 10),
  active_preset_id text,
  alerts_enabled   boolean not null default true,
  alert_venues     boolean not null default true,
  alert_artists    boolean not null default true,
  alert_events     boolean not null default true,
  email_opt_in     boolean not null default false,
  push_opt_in      boolean not null default false,
  saved_filters    jsonb,
  updated_at       timestamptz not null default now(),
  check (pg_column_size(ranking_presets) < 32000 and (saved_filters is null or pg_column_size(saved_filters) < 8000))
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists touch_user_preferences on public.user_preferences;
create trigger touch_user_preferences before insert or update on public.user_preferences for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- DJs e artistas favoritos
-- (casas, festas e eventos continuam em public.favorites — sem duplicação)
-- ---------------------------------------------------------------------
create table if not exists public.user_favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('dj', 'artist')),
  name       text not null check (char_length(name) between 2 and 80),
  name_key   text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name_key)
);
create index if not exists user_favorites_key_idx on public.user_favorites (name_key);

create or replace function public.set_favorite_name_key()
returns trigger language plpgsql as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.name_key := public.normalize_name(new.name);
  return new;
end $$;
drop trigger if exists set_favorite_name_key on public.user_favorites;
create trigger set_favorite_name_key before insert or update on public.user_favorites for each row execute function public.set_favorite_name_key();

create or replace function public.limit_user_favorites()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.user_favorites where user_id = new.user_id) >= 100 then
    raise exception 'Limite de 100 artistas seguidos.';
  end if;
  return new;
end $$;
drop trigger if exists limit_user_favorites on public.user_favorites;
create trigger limit_user_favorites before insert on public.user_favorites for each row execute function public.limit_user_favorites();

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('artist_event', 'venue_event', 'event_reminder', 'benefit', 'system')),
  title        text not null,
  body         text not null default '',
  link         text,
  venue_id     uuid references public.venues (id) on delete cascade,
  event_id     uuid references public.events (id) on delete cascade,
  dedupe_key   text not null,
  -- Arquitetura para canais externos: 'not_requested' (sem opt-in), 'not_configured'
  -- (opt-in, mas provedor não integrado), 'pending' → 'sent'/'failed' quando integrado.
  email_status text not null default 'not_requested' check (email_status in ('not_requested', 'not_configured', 'pending', 'sent', 'failed')),
  push_status  text not null default 'not_requested' check (push_status in ('not_requested', 'not_configured', 'pending', 'sent', 'failed')),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- O usuário só pode marcar como lida — título, corpo e canais são do servidor.
create or replace function public.protect_notification_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id := old.id; new.user_id := old.user_id; new.kind := old.kind; new.title := old.title; new.body := old.body;
    new.link := old.link; new.venue_id := old.venue_id; new.event_id := old.event_id; new.dedupe_key := old.dedupe_key;
    new.email_status := old.email_status; new.push_status := old.push_status; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists protect_notification_fields on public.notifications;
create trigger protect_notification_fields before update on public.notifications for each row execute function public.protect_notification_fields();

-- "neste sábado", "amanhã", "em 12/12" — espelha relativeDay() em TypeScript
create or replace function public.relative_day_pt(p date)
returns text language sql stable as $$
  select case
    when p = current_date then 'hoje'
    when p = current_date + 1 then 'amanhã'
    when p > current_date + 1 and p < current_date + 7 then
      (case when extract(dow from p) in (0, 6) then 'neste ' else 'nesta ' end)
      || (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from p)::int + 1]
    else 'em ' || to_char(p, 'DD/MM')
  end;
$$;

-- Gera notificações para um evento futuro (todos os seguidores premium, ou só p_only_user).
create or replace function public.notify_followers_for_event(p_event uuid, p_only_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  e public.events;
  v public.venues;
  n int := 0;
  k int;
begin
  select * into e from public.events where id = p_event;
  if not found or e.event_date < current_date then return 0; end if;
  select * into v from public.venues where id = e.venue_id;

  -- DJs / artistas seguidos
  insert into public.notifications (user_id, kind, title, body, link, venue_id, event_id, dedupe_key, email_status, push_status)
  select distinct on (uf.user_id, uf.name_key)
    uf.user_id, 'artist_event',
    (case when uf.kind = 'dj' then 'Seu DJ favorito' else 'Seu artista favorito' end) || ' vai tocar ' || public.relative_day_pt(e.event_date) || '!',
    d.name || ' está no line-up de ' || e.name || ', em ' || v.name || '.',
    '/eventos/' || e.slug, e.venue_id, e.id, 'dj:' || e.id || ':' || uf.name_key,
    case when coalesce(p.email_opt_in, false) then 'not_configured' else 'not_requested' end,
    case when coalesce(p.push_opt_in, false) then 'not_configured' else 'not_requested' end
  from unnest(e.dj_names) as d(name)
  join public.user_favorites uf on uf.name_key = public.normalize_name(d.name)
  left join public.user_preferences p on p.user_id = uf.user_id
  where (p_only_user is null or uf.user_id = p_only_user)
    and coalesce(p.alerts_enabled, true) and coalesce(p.alert_artists, true)
    and public._has_premium(uf.user_id)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Casas / festas favoritas
  insert into public.notifications (user_id, kind, title, body, link, venue_id, event_id, dedupe_key, email_status, push_status)
  select f.user_id, 'venue_event',
    case when e.event_date <= current_date + 7 then 'Uma nova atração foi adicionada à programação desta semana.'
         else 'Nova festa anunciada na sua ' || (case when v.category = 'boate' then 'boate' else 'casa' end) || ' favorita.' end,
    v.name || ': ' || e.name || ' — ' || public.relative_day_pt(e.event_date) || coalesce(', às ' || nullif(e.start_time, ''), '') || '.',
    '/eventos/' || e.slug, e.venue_id, e.id, 'venue:' || e.id,
    case when coalesce(p.email_opt_in, false) then 'not_configured' else 'not_requested' end,
    case when coalesce(p.push_opt_in, false) then 'not_configured' else 'not_requested' end
  from public.favorites f
  left join public.user_preferences p on p.user_id = f.user_id
  where f.venue_id = e.venue_id
    and (p_only_user is null or f.user_id = p_only_user)
    and coalesce(p.alerts_enabled, true) and coalesce(p.alert_venues, true)
    and public._has_premium(f.user_id)
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Lembrete de evento salvo (3 dias antes)
  if e.event_date <= current_date + 3 then
    insert into public.notifications (user_id, kind, title, body, link, venue_id, event_id, dedupe_key, email_status, push_status)
    select f.user_id, 'event_reminder',
      'Seu evento salvo é ' || public.relative_day_pt(e.event_date) || '.',
      e.name || ' em ' || v.name || coalesce(', às ' || nullif(e.start_time, ''), '') || '.',
      '/eventos/' || e.slug, e.venue_id, e.id, 'event:' || e.id || ':reminder',
      case when coalesce(p.email_opt_in, false) then 'not_configured' else 'not_requested' end,
      case when coalesce(p.push_opt_in, false) then 'not_configured' else 'not_requested' end
    from public.favorites f
    left join public.user_preferences p on p.user_id = f.user_id
    where f.event_id = e.id
      and (p_only_user is null or f.user_id = p_only_user)
      and coalesce(p.alerts_enabled, true) and coalesce(p.alert_events, true)
      and public._has_premium(f.user_id)
    on conflict (user_id, dedupe_key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;
revoke execute on function public.notify_followers_for_event(uuid, uuid) from public, anon, authenticated;

-- Novo evento (ou line-up alterado) → alertas imediatos
create or replace function public.on_event_change_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_followers_for_event(new.id, null);
  return null;
end $$;
drop trigger if exists on_event_change_notify on public.events;
create trigger on_event_change_notify after insert or update of dj_names, event_date, venue_id on public.events
  for each row execute function public.on_event_change_notify();

-- Sincroniza os alertas do próprio usuário (novos favoritos, lembretes por data)
create or replace function public.sync_my_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare
  total int := 0;
  ev record;
begin
  if auth.uid() is null or not public._has_premium(auth.uid()) then return 0; end if;
  for ev in select id from public.events where event_date >= current_date and event_date <= current_date + 120 loop
    total := total + public.notify_followers_for_event(ev.id, auth.uid());
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------
-- Benefícios em casas parceiras
-- ---------------------------------------------------------------------
create table if not exists public.premium_benefits (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  description    text not null check (char_length(description) <= 1000),
  rules          text not null check (char_length(rules) <= 2000),
  how_to_redeem  text not null check (char_length(how_to_redeem) <= 1000),
  image_url      text not null default '',
  valid_until    date not null,
  total_quantity int check (total_quantity is null or total_quantity > 0),
  active         boolean not null default true,
  -- Exemplo/demonstração: NÃO representa acordo real e não pode ser resgatado.
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists premium_benefits_venue_idx on public.premium_benefits (venue_id);

create table if not exists public.benefit_redemptions (
  id         uuid primary key default gen_random_uuid(),
  benefit_id uuid not null references public.premium_benefits (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now(),
  unique (benefit_id, user_id)
);

-- Contagem pública de resgates (sem revelar quem resgatou)
create or replace function public.benefit_redemption_counts()
returns table (benefit_id uuid, redeemed int)
language sql stable security definer set search_path = public as $$
  select benefit_id, count(*)::int from public.benefit_redemptions group by benefit_id;
$$;

-- ---------------------------------------------------------------------
-- Histórico de atividade
-- ---------------------------------------------------------------------
create table if not exists public.user_activity_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('review_published', 'review_updated', 'benefit_redeemed', 'subscription_started', 'subscription_canceled')),
  venue_id   uuid references public.venues (id) on delete set null,
  review_id  uuid references public.venue_reviews (id) on delete set null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on public.user_activity_history (user_id, created_at desc);

create or replace function public.log_review_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Mudança apenas de status (moderação) não é atividade do autor.
  if tg_op = 'UPDATE' and (new.comment, new.photos, new.overall_rating, new.experience_date)
       is not distinct from (old.comment, old.photos, old.overall_rating, old.experience_date) then
    return null;
  end if;
  insert into public.user_activity_history (user_id, kind, venue_id, review_id, metadata, created_at)
  values (new.user_id, case when tg_op = 'INSERT' then 'review_published' else 'review_updated' end, new.venue_id, new.id,
          jsonb_build_object('venue', (select name from public.venues where id = new.venue_id), 'rating', new.overall_rating, 'photos', cardinality(new.photos)),
          case when tg_op = 'INSERT' then new.created_at else now() end);
  return null;
end $$;
drop trigger if exists log_review_activity on public.venue_reviews;
create trigger log_review_activity after insert or update on public.venue_reviews for each row execute function public.log_review_activity();

create or replace function public.log_subscription_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_activity_history (user_id, kind, metadata) values (new.user_id, 'subscription_started', jsonb_build_object('plan', new.plan_id, 'trial', new.trial_start is not null));
  elsif new.cancel_at_period_end and not old.cancel_at_period_end then
    insert into public.user_activity_history (user_id, kind, metadata) values (new.user_id, 'subscription_canceled', jsonb_build_object('access_until', new.current_period_end));
  end if;
  return null;
end $$;
drop trigger if exists log_subscription_activity on public.subscriptions;
create trigger log_subscription_activity after insert or update on public.subscriptions for each row execute function public.log_subscription_activity();

-- Resgate: premium vigente, benefício real, disponível, um por assinante. Bloqueia a
-- linha do benefício para não exceder a quantidade em resgates simultâneos.
create or replace function public.redeem_benefit(p_benefit uuid)
returns public.benefit_redemptions language plpgsql security definer set search_path = public as $$
declare
  b public.premium_benefits;
  r public.benefit_redemptions;
  used int;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para continuar.'; end if;
  if not public._has_premium(auth.uid()) then raise exception 'Recurso exclusivo para assinantes Classify+.'; end if;
  select * into b from public.premium_benefits where id = p_benefit for update;
  if not found then raise exception 'Benefício não encontrado.'; end if;
  if b.is_demo then raise exception 'Este é um benefício de exemplo e não pode ser resgatado.'; end if;
  select * into r from public.benefit_redemptions where benefit_id = p_benefit and user_id = auth.uid();
  if found then return r; end if;
  if not b.active then raise exception 'Benefício indisponível.'; end if;
  if b.valid_until < current_date then raise exception 'Benefício expirado.'; end if;
  select count(*) into used from public.benefit_redemptions where benefit_id = p_benefit;
  if b.total_quantity is not null and used >= b.total_quantity then raise exception 'Benefício esgotado.'; end if;
  insert into public.benefit_redemptions (benefit_id, user_id, code)
  values (p_benefit, auth.uid(), 'CPLUS-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)))
  returning * into r;
  insert into public.user_activity_history (user_id, kind, venue_id, metadata)
  values (auth.uid(), 'benefit_redeemed', b.venue_id, jsonb_build_object('benefit', b.title));
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Métricas administrativas (estimado ≠ recebido) — espelha computePlusMetrics()
-- ---------------------------------------------------------------------
create or replace function public.admin_plus_metrics()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  res json;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  with latest as (
    select distinct on (user_id) * from public.subscriptions order by user_id, created_at desc
  ),
  acc as (
    select l.*, p.price_cents,
      (l.status in ('trialing', 'active', 'canceled')
        and coalesce(case when l.status = 'trialing' then coalesce(l.trial_end, l.current_period_end) else l.current_period_end end, '-infinity') > now()) as has_access
    from latest l join public.subscription_plans p on p.id = l.plan_id
  ),
  agg as (
    select
      count(*) filter (where has_access) as subscribers,
      count(*) filter (where has_access and status = 'active' and plan_id = 'monthly') as monthly_active,
      count(*) filter (where has_access and status = 'active' and plan_id = 'annual') as annual_active,
      count(*) filter (where has_access and status = 'trialing') as trialing,
      count(*) filter (where has_access and status = 'canceled') as canceled_with_access,
      count(*) filter (where not has_access and status not in ('past_due', 'incomplete')) as expired,
      count(*) filter (where status = 'past_due') as past_due,
      count(*) filter (where has_access and status in ('active', 'canceled')) as paying,
      coalesce(sum(case when has_access and status = 'active' then case when plan_id = 'annual' then price_cents / 12.0 else price_cents end end), 0) as mrr,
      coalesce(sum(case when has_access and status in ('active', 'canceled') and plan_id = 'annual' then price_cents end), 0) as annual_contracted
    from acc
  ),
  users as (select count(*)::numeric as n from public.profiles)
  select json_build_object(
    'total_users', users.n,
    'subscribers', agg.subscribers,
    'monthly_active', agg.monthly_active,
    'annual_active', agg.annual_active,
    'trialing', agg.trialing,
    'canceled_with_access', agg.canceled_with_access,
    'expired', agg.expired,
    'past_due', agg.past_due,
    'conversion_rate', case when users.n = 0 then 0 else agg.paying / users.n end,
    'mrr_estimated_cents', round(agg.mrr),
    'arr_run_rate_cents', round(agg.mrr * 12),
    'annual_contracted_cents', agg.annual_contracted,
    'received_total_cents', (select coalesce(sum(amount_cents), 0) from public.subscription_payments where status = 'paid'),
    'received_30d_cents', (select coalesce(sum(amount_cents), 0) from public.subscription_payments where status = 'paid' and paid_at > now() - interval '30 days'),
    'failed_payments_30d', (select count(*) from public.subscription_payments where status = 'failed' and created_at > now() - interval '30 days'),
    'top_benefits', coalesce((
      select json_agg(t) from (
        select b.id as benefit_id, b.title, v.name as venue_name, count(r.id)::int as redemptions
        from public.premium_benefits b
        join public.venues v on v.id = b.venue_id
        join public.benefit_redemptions r on r.benefit_id = b.id
        group by b.id, b.title, v.name
        order by redemptions desc
        limit 5
      ) t
    ), '[]'::json)
  ) into res
  from agg cross join users;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- remove_demo_data: inclui os benefícios demonstrativos
-- ---------------------------------------------------------------------
create or replace function public.remove_demo_data()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  delete from public.premium_benefits where is_demo;
  delete from public.venues where is_demo;           -- cascata: avaliações, eventos, favoritos, curtidas, benefícios
  delete from public.events where is_demo;
  delete from public.venue_reviews where is_demo;
  delete from public.event_reviews where is_demo;
  delete from auth.users where coalesce((raw_app_meta_data->>'demo')::boolean, false) and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_favorites enable row level security;
alter table public.notifications enable row level security;
alter table public.premium_benefits enable row level security;
alter table public.benefit_redemptions enable row level security;
alter table public.user_activity_history enable row level security;

-- Planos: leitura pública; escrita admin
drop policy if exists "plans read" on public.subscription_plans;
create policy "plans read" on public.subscription_plans for select using (true);
drop policy if exists "plans admin" on public.subscription_plans;
create policy "plans admin" on public.subscription_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Assinaturas e pagamentos: o próprio usuário (leitura) e admin. SEM escrita pelo cliente —
-- somente o webhook do servidor (service_role, que ignora RLS) altera estes dados.
drop policy if exists "subscriptions read own" on public.subscriptions;
create policy "subscriptions read own" on public.subscriptions for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "payments read own" on public.subscription_payments;
create policy "payments read own" on public.subscription_payments for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "webhook events admin" on public.billing_webhook_events;
create policy "webhook events admin" on public.billing_webhook_events for select to authenticated using (public.is_admin());

-- Preferências e artistas: privados
drop policy if exists "preferences own" on public.user_preferences;
create policy "preferences own" on public.user_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "artist favorites own" on public.user_favorites;
create policy "artist favorites own" on public.user_favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notificações: leitura/atualização (read_at)/remoção do próprio usuário; criação só pelo servidor
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Benefícios: ativos são públicos (vitrine); admin gerencia tudo
drop policy if exists "benefits read" on public.premium_benefits;
create policy "benefits read" on public.premium_benefits for select using (active or public.is_admin());
drop policy if exists "benefits admin" on public.premium_benefits;
create policy "benefits admin" on public.premium_benefits for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Resgates: o próprio usuário e admin leem; criação só via redeem_benefit()
drop policy if exists "redemptions read own" on public.benefit_redemptions;
create policy "redemptions read own" on public.benefit_redemptions for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Histórico: privado
drop policy if exists "activity read own" on public.user_activity_history;
create policy "activity read own" on public.user_activity_history for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- RPCs: nada para visitantes anônimos
revoke execute on function public.sync_my_notifications() from anon;
revoke execute on function public.redeem_benefit(uuid) from anon;
revoke execute on function public.admin_plus_metrics() from anon;
revoke execute on function public.has_premium() from anon;
