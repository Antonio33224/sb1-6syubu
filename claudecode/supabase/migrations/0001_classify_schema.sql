-- =====================================================================
-- CLASSIFY DJ — schema, segurança (RLS), regras de negócio e rankings
-- Execute no SQL Editor do Supabase (ou `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._]{3,24}$'),
  full_name   text not null default '' check (char_length(full_name) <= 80),
  avatar_url  text,
  city        text check (char_length(city) <= 80),
  bio         text check (char_length(bio) <= 280),
  role        text not null default 'user' check (role in ('user', 'admin')),
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  description   text not null default '',
  category      text not null default 'boate' check (category in ('boate', 'festa', 'festival', 'experiencia')),
  city          text not null,
  state         text not null check (char_length(state) = 2),
  neighborhood  text not null default '',
  address       text not null default '',
  latitude      double precision,
  longitude     double precision,
  cover_image   text not null default '',
  gallery       text[] not null default '{}',
  instagram_url text,
  website_url   text,
  price_range   smallint not null default 2 check (price_range between 1 and 4),
  music_styles  text[] not null default '{}',
  opening_days  text[] not null default '{}',
  approved      boolean not null default false, -- mantido por trigger, nunca pelo cliente
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists venues_city_idx on public.venues (city, state);
create index if not exists venues_category_idx on public.venues (category);
create index if not exists venues_styles_idx on public.venues using gin (music_styles);

create table if not exists public.venue_reviews (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  venue_id            uuid not null references public.venues (id) on delete cascade,
  music_rating        numeric(3,1) not null check (music_rating between 0 and 10),
  crowd_rating        numeric(3,1) not null check (crowd_rating between 0 and 10),
  atmosphere_rating   numeric(3,1) not null check (atmosphere_rating between 0 and 10),
  drinks_rating       numeric(3,1) not null check (drinks_rating between 0 and 10),
  service_rating      numeric(3,1) not null check (service_rating between 0 and 10),
  organization_rating numeric(3,1) not null check (organization_rating between 0 and 10),
  experience_rating   numeric(3,1) not null check (experience_rating between 0 and 10),
  overall_rating      numeric(3,1) not null default 0, -- calculada no servidor
  comment             text not null default '' check (char_length(comment) <= 2000),
  experience_date     date,
  photos              text[] not null default '{}' check (cardinality(photos) <= 4),
  status              text not null default 'published' check (status in ('published', 'flagged', 'hidden')),
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint one_active_review_per_venue unique (user_id, venue_id)
);
create index if not exists venue_reviews_venue_idx on public.venue_reviews (venue_id, created_at desc);
create index if not exists venue_reviews_user_idx on public.venue_reviews (user_id, updated_at desc);
create index if not exists venue_reviews_recent_idx on public.venue_reviews (created_at desc);

create table if not exists public.venue_review_revisions (
  id                  uuid primary key default gen_random_uuid(),
  review_id           uuid not null references public.venue_reviews (id) on delete cascade,
  music_rating        numeric(3,1) not null,
  crowd_rating        numeric(3,1) not null,
  atmosphere_rating   numeric(3,1) not null,
  drinks_rating       numeric(3,1) not null,
  service_rating      numeric(3,1) not null,
  organization_rating numeric(3,1) not null,
  experience_rating   numeric(3,1) not null,
  overall_rating      numeric(3,1) not null,
  comment             text not null,
  experience_date     date,
  created_at          timestamptz not null default now()
);
create index if not exists revisions_review_idx on public.venue_review_revisions (review_id, created_at desc);

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 140),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  description   text not null default '',
  cover_image   text not null default '',
  event_date    date not null,
  start_time    text not null default '23:00',
  ticket_price  numeric(10,2) check (ticket_price >= 0),
  ticket_url    text,
  dj_names      text[] not null default '{}',
  music_styles  text[] not null default '{}',
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);
create index if not exists events_venue_idx on public.events (venue_id);

create table if not exists public.event_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  rating     numeric(3,1) not null check (rating between 0 and 10),
  comment    text not null default '' check (char_length(comment) <= 2000),
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  venue_id   uuid references public.venues (id) on delete cascade,
  event_id   uuid references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(venue_id, event_id) = 1),
  unique (user_id, venue_id),
  unique (user_id, event_id)
);

create table if not exists public.review_likes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  review_id  uuid not null references public.venue_reviews (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, review_id)
);
create index if not exists review_likes_review_idx on public.review_likes (review_id);

create table if not exists public.review_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  review_id  uuid not null references public.venue_reviews (id) on delete cascade,
  reason     text not null check (char_length(reason) between 5 and 500),
  status     text not null default 'pending' check (status in ('pending', 'dismissed', 'upheld')),
  created_at timestamptz not null default now(),
  unique (user_id, review_id)
);

create table if not exists public.newsletter (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id                       int primary key default 1 check (id = 1),
  approved_min_rating      numeric(3,1) not null default 8.5,
  approved_min_reviews     int not null default 20,
  approved_max_flag_ratio  numeric(4,3) not null default 0.1,
  bayes_prior_weight       numeric not null default 10,
  recency_half_life_days   numeric not null default 180,
  music_styles             text[] not null default array['Eletrônica','House','Techno','Hip-hop','Funk','Open format','Pop','Disco','Samba','Trap']
);
insert into public.platform_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Nota geral ponderada — espelha src/lib/rating.ts
create or replace function public.compute_overall_rating(
  music numeric, crowd numeric, atmosphere numeric, drinks numeric, service numeric, organization numeric, experience numeric
) returns numeric language sql immutable as $$
  select round((music * 0.20 + crowd * 0.15 + atmosphere * 0.15 + drinks * 0.10 + service * 0.10 + organization * 0.10 + experience * 0.20) / 1.0, 1);
$$;

-- Perfil automático no cadastro
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), '[^a-z0-9._]', '', 'g'));
  if char_length(base) < 3 then base := base || 'user'; end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    n := n + 1;
    candidate := base || n::text;
  end loop;
  insert into public.profiles (id, username, full_name, is_demo)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'full_name', ''),
          coalesce((new.raw_app_meta_data->>'demo')::boolean, false));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Usuário comum não pode alterar o próprio papel nem a marcação demo
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.is_demo := old.is_demo;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------
-- Regras das avaliações (servidor é a fonte da verdade)
-- ---------------------------------------------------------------------

create or replace function public.enforce_review_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  -- Contexto de serviço (SQL editor / seed, auth.uid() nulo) ou chamada interna de outra
  -- função security definer (ex.: sinalização automática por denúncias): apenas recalcula a nota.
  if uid is null or pg_trigger_depth() > 1 then
    new.overall_rating := public.compute_overall_rating(new.music_rating, new.crowd_rating, new.atmosphere_rating,
      new.drinks_rating, new.service_rating, new.organization_rating, new.experience_rating);
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> uid then raise exception 'Não é possível avaliar em nome de outra pessoa.'; end if;
    new.status := 'published';
    new.is_demo := false;
    new.created_at := now();
  else
    -- Moderador (não autor): pode alterar apenas o status de visibilidade.
    if old.user_id <> uid then
      if not public.is_admin() then raise exception 'Sem permissão.'; end if;
      if (new.music_rating, new.crowd_rating, new.atmosphere_rating, new.drinks_rating, new.service_rating,
          new.organization_rating, new.experience_rating, new.comment, new.photos, new.experience_date, new.user_id, new.venue_id)
         is distinct from
         (old.music_rating, old.crowd_rating, old.atmosphere_rating, old.drinks_rating, old.service_rating,
          old.organization_rating, old.experience_rating, old.comment, old.photos, old.experience_date, old.user_id, old.venue_id) then
        raise exception 'A moderação não altera o conteúdo de avaliações legítimas.';
      end if;
      return new;
    end if;
    -- Autor: não troca dono/local/status/demo
    new.user_id := old.user_id;
    new.venue_id := old.venue_id;
    new.status := old.status;
    new.is_demo := old.is_demo;
    new.created_at := old.created_at;
    insert into public.venue_review_revisions (review_id, music_rating, crowd_rating, atmosphere_rating, drinks_rating,
      service_rating, organization_rating, experience_rating, overall_rating, comment, experience_date, created_at)
    values (old.id, old.music_rating, old.crowd_rating, old.atmosphere_rating, old.drinks_rating, old.service_rating,
      old.organization_rating, old.experience_rating, old.overall_rating, old.comment, old.experience_date, old.updated_at);
  end if;

  -- Anti-spam
  select count(*) into recent from public.venue_reviews
   where user_id = uid and updated_at > now() - interval '1 hour' and id <> new.id;
  if recent >= 5 then raise exception 'Limite de avaliações por hora atingido. Tente novamente mais tarde.'; end if;
  if new.comment ~* '(https?://|www\.)' then raise exception 'Links não são permitidos nos comentários.'; end if;
  if char_length(trim(new.comment)) between 1 and 9 then raise exception 'O comentário precisa de pelo menos 10 caracteres.'; end if;
  if trim(new.comment) <> '' and exists (
    select 1 from public.venue_reviews where user_id = uid and venue_id <> new.venue_id and trim(comment) = trim(new.comment)
  ) then raise exception 'Você já publicou este mesmo comentário em outra avaliação.'; end if;
  if new.experience_date > current_date + 1 then raise exception 'A data da experiência não pode estar no futuro.'; end if;

  new.comment := trim(new.comment);
  new.updated_at := now();
  new.overall_rating := public.compute_overall_rating(new.music_rating, new.crowd_rating, new.atmosphere_rating,
    new.drinks_rating, new.service_rating, new.organization_rating, new.experience_rating);
  return new;
end $$;

drop trigger if exists enforce_review_rules on public.venue_reviews;
create trigger enforce_review_rules before insert or update on public.venue_reviews
  for each row execute function public.enforce_review_rules();

-- Curtidas/denúncias na própria avaliação são bloqueadas
create or replace function public.prevent_self_interaction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.venue_reviews where id = new.review_id and user_id = new.user_id) then
    raise exception 'Você não pode interagir com a própria avaliação.';
  end if;
  return new;
end $$;
drop trigger if exists prevent_self_like on public.review_likes;
create trigger prevent_self_like before insert on public.review_likes for each row execute function public.prevent_self_interaction();
drop trigger if exists prevent_self_report on public.review_reports;
create trigger prevent_self_report before insert on public.review_reports for each row execute function public.prevent_self_interaction();

-- 3 denúncias pendentes => avaliação sinalizada (peso reduzido até moderação)
create or replace function public.flag_reported_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.review_reports where review_id = new.review_id and status = 'pending') >= 3 then
    update public.venue_reviews set status = 'flagged' where id = new.review_id and status = 'published';
  end if;
  return new;
end $$;
drop trigger if exists flag_reported_review on public.review_reports;
create trigger flag_reported_review after insert on public.review_reports for each row execute function public.flag_reported_review();

create or replace function public.check_event_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.user_id <> auth.uid() then raise exception 'Sem permissão.'; end if;
    if (select event_date from public.events where id = new.event_id) > current_date then
      raise exception 'Só é possível avaliar edições que já aconteceram.';
    end if;
    if new.comment ~* '(https?://|www\.)' then raise exception 'Links não são permitidos nos comentários.'; end if;
    new.is_demo := false;
  end if;
  return new;
end $$;
drop trigger if exists check_event_review on public.event_reviews;
create trigger check_event_review before insert or update on public.event_reviews for each row execute function public.check_event_review();

-- ---------------------------------------------------------------------
-- Estatísticas e selo CLASSIFYDJ APPROVED
-- ---------------------------------------------------------------------

create or replace view public.venue_stats with (security_invoker = true) as
with s as (select * from public.platform_settings where id = 1),
gm as (select coalesce(avg(overall_rating), 7) as c from public.venue_reviews where status <> 'hidden'),
r as (
  select vr.*,
    (case when vr.status = 'flagged' then 0.5 else 1 end)
    * greatest(0.25, power(0.5, extract(epoch from (now() - vr.created_at)) / 86400.0 / (select recency_half_life_days from s))) as wt
  from public.venue_reviews vr where vr.status <> 'hidden'
),
agg as (
  select venue_id, count(*)::int as review_count, round(avg(overall_rating), 1) as avg_rating,
    sum(overall_rating * wt) as wsum, sum(wt) as wtot,
    round(avg(music_rating), 1) as music_rating, round(avg(crowd_rating), 1) as crowd_rating,
    round(avg(atmosphere_rating), 1) as atmosphere_rating, round(avg(drinks_rating), 1) as drinks_rating,
    round(avg(service_rating), 1) as service_rating, round(avg(organization_rating), 1) as organization_rating,
    round(avg(experience_rating), 1) as experience_rating,
    count(*) filter (where overall_rating >= 9)::int as d0,
    count(*) filter (where overall_rating >= 7 and overall_rating < 9)::int as d1,
    count(*) filter (where overall_rating >= 5 and overall_rating < 7)::int as d2,
    count(*) filter (where overall_rating >= 3 and overall_rating < 5)::int as d3,
    count(*) filter (where overall_rating < 3)::int as d4
  from r group by venue_id
)
select v.id as venue_id,
  coalesce(a.review_count, 0) as review_count,
  coalesce(a.avg_rating, 0) as avg_rating,
  coalesce(round(((a.wtot / (a.wtot + s.bayes_prior_weight)) * (a.wsum / a.wtot)
    + (s.bayes_prior_weight / (a.wtot + s.bayes_prior_weight)) * gm.c)::numeric, 3), 0) as score,
  a.music_rating, a.crowd_rating, a.atmosphere_rating, a.drinks_rating, a.service_rating, a.organization_rating, a.experience_rating,
  array[coalesce(a.d0,0), coalesce(a.d1,0), coalesce(a.d2,0), coalesce(a.d3,0), coalesce(a.d4,0)] as distribution,
  v.approved
from public.venues v
left join agg a on a.venue_id = v.id
cross join s cross join gm;

create or replace function public.refresh_venue_approved(p_venue uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.platform_settings;
  n int; avg_r numeric; total int; flagged int;
begin
  select * into s from public.platform_settings where id = 1;
  select count(*) filter (where status <> 'hidden'), round(avg(overall_rating) filter (where status <> 'hidden'), 1),
         count(*), count(*) filter (where status <> 'published')
    into n, avg_r, total, flagged
    from public.venue_reviews where venue_id = p_venue;
  update public.venues set approved = (
    coalesce(avg_r, 0) >= s.approved_min_rating
    and n >= s.approved_min_reviews
    and (case when total = 0 then 0 else flagged::numeric / total end) <= s.approved_max_flag_ratio
  ) where id = p_venue;
end $$;

create or replace function public.on_review_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_venue_approved(coalesce(new.venue_id, old.venue_id));
  return null;
end $$;
drop trigger if exists on_review_change on public.venue_reviews;
create trigger on_review_change after insert or update or delete on public.venue_reviews
  for each row execute function public.on_review_change();

create or replace function public.on_settings_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_venue_approved(id) from public.venues;
  return null;
end $$;
drop trigger if exists on_settings_change on public.platform_settings;
create trigger on_settings_change after update on public.platform_settings
  for each statement execute function public.on_settings_change();

-- ---------------------------------------------------------------------
-- Rankings — espelha src/lib/ranking.ts
-- ---------------------------------------------------------------------

create or replace function public.ranking_snapshot(
  p_now timestamptz, p_category text, p_period text, p_city text, p_state text, p_min_rating numeric
) returns table (venue_id uuid, name text, sort_key numeric, avg_rating numeric, review_count int, score numeric)
language sql stable security invoker set search_path = public as $$
with s as (select * from public.platform_settings where id = 1),
base as (select * from public.venue_reviews where created_at <= p_now and status <> 'hidden'),
gm as (select coalesce(avg(overall_rating), 7) as c from base),
win as (
  select * from base
  where case p_period when 'semana' then created_at > p_now - interval '7 days'
                      when 'mes' then created_at > p_now - interval '30 days' else true end
),
v as (
  select * from public.venues
  where (p_category in ('all', 'hype', 'ascensao')
         or category = case p_category when 'boates' then 'boate' when 'festas' then 'festa'
                                       when 'festivais' then 'festival' when 'experiencias' then 'experiencia' end)
    and (p_city is null or city = p_city)
    and (p_state is null or state = p_state)
),
w as (
  select win.*, (case when status = 'flagged' then 0.5 else 1 end)
    * (case when p_period = 'historico' then 1
            else greatest(0.25, power(0.5, extract(epoch from (p_now - created_at)) / 86400.0 / (select recency_half_life_days from s))) end) as wt
  from win
),
agg as (
  select w.venue_id, count(*)::int as n, round(avg(overall_rating), 1) as avg_rating,
         sum(overall_rating * wt) as wsum, sum(wt) as wtot
  from w group by w.venue_id
),
scored as (
  select v.id as venue_id, v.name, a.n, a.avg_rating,
    ((a.wtot / (a.wtot + s.bayes_prior_weight)) * (a.wsum / a.wtot)
      + (s.bayes_prior_weight / (a.wtot + s.bayes_prior_weight)) * gm.c)::numeric as score
  from v join agg a on a.venue_id = v.id cross join s cross join gm
),
hype as (
  select r.venue_id, count(distinct r.id) as rc,
         count(l.id) filter (where l.created_at > p_now - interval '30 days' and l.created_at <= p_now) as lc
  from base r left join public.review_likes l on l.review_id = r.id
  where r.created_at > p_now - interval '30 days'
  group by r.venue_id
),
rising as (
  select venue_id,
    avg(overall_rating) filter (where created_at > p_now - interval '30 days') as recent_avg,
    count(*) filter (where created_at > p_now - interval '30 days') as recent_n,
    avg(overall_rating) filter (where created_at <= p_now - interval '30 days') as old_avg
  from base group by venue_id
)
select sc.venue_id, sc.name,
  case p_category
    when 'hype' then (coalesce(h.rc, 0) * 3 + coalesce(h.lc, 0))::numeric + sc.score / 100
    when 'ascensao' then (ri.recent_avg - coalesce(ri.old_avg, gm.c)) * (ri.recent_n / (ri.recent_n + 3.0))
    else sc.score
  end as sort_key,
  sc.avg_rating, sc.n, round(sc.score, 3)
from scored sc
cross join gm
left join hype h on h.venue_id = sc.venue_id
left join rising ri on ri.venue_id = sc.venue_id
where (p_category <> 'ascensao' or (coalesce(ri.recent_n, 0) >= 2 and sc.n >= 2))
  and (p_min_rating is null or sc.avg_rating >= p_min_rating);
$$;

create or replace function public.get_rankings(
  p_category text default 'all', p_period text default 'geral', p_city text default null,
  p_state text default null, p_min_rating numeric default null, p_limit int default null
) returns table (venue_id uuid, "position" int, score numeric, avg_rating numeric, review_count int, prev_position int)
language sql stable security invoker set search_path = public as $$
with cur as (
  select c.*, row_number() over (order by c.sort_key desc, c.review_count desc, c.name) as pos
  from public.ranking_snapshot(now(), p_category, p_period, p_city, p_state, p_min_rating) c
),
prev as (
  select p.venue_id, row_number() over (order by p.sort_key desc, p.review_count desc, p.name) as pos
  from public.ranking_snapshot(now() - interval '7 days', p_category, p_period, p_city, p_state, p_min_rating) p
)
select cur.venue_id, cur.pos::int, cur.score, cur.avg_rating, cur.review_count, prev.pos::int
from cur left join prev on prev.venue_id = cur.venue_id
order by cur.pos
limit coalesce(p_limit, 1000);
$$;

-- ---------------------------------------------------------------------
-- RPCs auxiliares
-- ---------------------------------------------------------------------

create or replace function public.user_stats(p_user uuid)
returns table (review_count int, likes_received int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.venue_reviews where user_id = p_user and status <> 'hidden'),
    (select count(*)::int from public.review_likes l join public.venue_reviews r on r.id = l.review_id
      where r.user_id = p_user and r.status <> 'hidden');
$$;

create or replace function public.admin_metrics()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  return json_build_object(
    'users', (select count(*) from public.profiles),
    'venues', (select count(*) from public.venues),
    'reviews', (select count(*) from public.venue_reviews where status <> 'hidden'),
    'events', (select count(*) from public.events),
    'avg_rating', (select coalesce(round(avg(overall_rating), 1), 0) from public.venue_reviews where status <> 'hidden'),
    'newsletter', (select count(*) from public.newsletter),
    'pending_reports', (select count(*) from public.review_reports where status = 'pending')
  );
end $$;

create or replace function public.admin_resolve_report(p_report uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select review_id into rid from public.review_reports where id = p_report;
  if rid is null then raise exception 'Denúncia não encontrada.'; end if;
  if p_action = 'hide_review' then
    update public.review_reports set status = 'upheld' where review_id = rid and status = 'pending';
    update public.venue_reviews set status = 'hidden' where id = rid;
  else
    update public.review_reports set status = 'dismissed' where id = p_report;
    if not exists (select 1 from public.review_reports where review_id = rid and status = 'pending') then
      update public.venue_reviews set status = 'published' where id = rid and status = 'flagged';
    end if;
  end if;
end $$;

-- Remove TODO o conteúdo demonstrativo (is_demo = true).
create or replace function public.remove_demo_data()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  delete from public.venues where is_demo;           -- cascata: avaliações, eventos, favoritos, curtidas
  delete from public.events where is_demo;
  delete from public.venue_reviews where is_demo;
  delete from public.event_reviews where is_demo;
  delete from auth.users where coalesce((raw_app_meta_data->>'demo')::boolean, false) and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.venue_reviews enable row level security;
alter table public.venue_review_revisions enable row level security;
alter table public.events enable row level security;
alter table public.event_reviews enable row level security;
alter table public.favorites enable row level security;
alter table public.review_likes enable row level security;
alter table public.review_reports enable row level security;
alter table public.newsletter enable row level security;
alter table public.platform_settings enable row level security;

-- profiles: perfis são públicos (sem e-mail); edição apenas do próprio perfil ou admin
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (true);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- venues / events: leitura pública, escrita admin
drop policy if exists "venues read" on public.venues;
create policy "venues read" on public.venues for select using (true);
drop policy if exists "venues admin write" on public.venues;
create policy "venues admin write" on public.venues for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select using (true);
drop policy if exists "events admin write" on public.events;
create policy "events admin write" on public.events for all using (public.is_admin()) with check (public.is_admin());

-- venue_reviews
drop policy if exists "reviews read" on public.venue_reviews;
create policy "reviews read" on public.venue_reviews for select using (status <> 'hidden' or user_id = auth.uid() or public.is_admin());
drop policy if exists "reviews insert own" on public.venue_reviews;
create policy "reviews insert own" on public.venue_reviews for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reviews update own or moderate" on public.venue_reviews;
create policy "reviews update own or moderate" on public.venue_reviews for update to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "reviews delete own" on public.venue_reviews;
create policy "reviews delete own" on public.venue_reviews for delete to authenticated using (user_id = auth.uid());

drop policy if exists "revisions read" on public.venue_review_revisions;
create policy "revisions read" on public.venue_review_revisions for select using (
  public.is_admin() or exists (select 1 from public.venue_reviews r where r.id = review_id and r.user_id = auth.uid())
);

-- event_reviews
drop policy if exists "event reviews read" on public.event_reviews;
create policy "event reviews read" on public.event_reviews for select using (true);
drop policy if exists "event reviews write own" on public.event_reviews;
create policy "event reviews write own" on public.event_reviews for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "event reviews update own" on public.event_reviews;
create policy "event reviews update own" on public.event_reviews for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "event reviews delete own" on public.event_reviews;
create policy "event reviews delete own" on public.event_reviews for delete to authenticated using (user_id = auth.uid());

-- favorites: privados
drop policy if exists "favorites own" on public.favorites;
create policy "favorites own" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- likes: contagem pública, escrita própria
drop policy if exists "likes read" on public.review_likes;
create policy "likes read" on public.review_likes for select using (true);
drop policy if exists "likes insert own" on public.review_likes;
create policy "likes insert own" on public.review_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "likes delete own" on public.review_likes;
create policy "likes delete own" on public.review_likes for delete to authenticated using (user_id = auth.uid());

-- reports: o autor da denúncia e admins veem; somente admin atualiza
drop policy if exists "reports read" on public.review_reports;
create policy "reports read" on public.review_reports for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "reports insert own" on public.review_reports;
create policy "reports insert own" on public.review_reports for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "reports admin update" on public.review_reports;
create policy "reports admin update" on public.review_reports for update to authenticated using (public.is_admin());

-- newsletter: qualquer visitante se inscreve; somente admin lê/remove
drop policy if exists "newsletter subscribe" on public.newsletter;
create policy "newsletter subscribe" on public.newsletter for insert to anon, authenticated with check (true);
drop policy if exists "newsletter admin" on public.newsletter;
create policy "newsletter admin" on public.newsletter for select to authenticated using (public.is_admin());
drop policy if exists "newsletter admin delete" on public.newsletter;
create policy "newsletter admin delete" on public.newsletter for delete to authenticated using (public.is_admin());

-- settings
drop policy if exists "settings read" on public.platform_settings;
create policy "settings read" on public.platform_settings for select using (true);
drop policy if exists "settings admin" on public.platform_settings;
create policy "settings admin" on public.platform_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- RPCs sensíveis
revoke execute on function public.remove_demo_data() from anon;
revoke execute on function public.admin_metrics() from anon;
revoke execute on function public.admin_resolve_report(uuid, text) from anon;

-- ---------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('review-photos', 'review-photos', true), ('venue-images', 'venue-images', true)
on conflict (id) do nothing;

drop policy if exists "public read classify buckets" on storage.objects;
create policy "public read classify buckets" on storage.objects for select
  using (bucket_id in ('avatars', 'review-photos', 'venue-images'));

drop policy if exists "users upload own folder" on storage.objects;
create policy "users upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'review-photos') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users manage own files" on storage.objects;
create policy "users manage own files" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'review-photos') and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "admins manage venue images" on storage.objects;
create policy "admins manage venue images" on storage.objects for all to authenticated
  using (bucket_id = 'venue-images' and public.is_admin())
  with check (bucket_id = 'venue-images' and public.is_admin());
