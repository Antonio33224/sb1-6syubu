-- =====================================================================
-- NO OFF — VENDA DE INGRESSOS, PRODUTORES, LISTA VIP, CHECK-IN E
-- VISIBILIDADE DE FESTAS. Execute depois de 0001–0005. Idempotente.
--
-- Papéis (profiles.role):
--   comprador    → compra ingressos, vê "Meus ingressos"
--   admin_festa  → produtor: cria/edita SOMENTE as próprias festas
--   super_admin  → administra a plataforma (public.is_admin())
--
-- Segurança dos campos ocultos: anon NÃO lê public.events. O público lê
-- public.public_events, uma view que devolve NULL nos campos ocultos —
-- o valor real nunca sai do banco para o navegador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis: suspensão de produtores
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_reason text check (char_length(suspended_reason) <= 300);

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.is_demo := old.is_demo;
    new.is_imported := old.is_imported;
    new.suspended_at := old.suspended_at;
    new.suspended_reason := old.suspended_reason;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- Produtor ativo (admin_festa ou super_admin, não suspenso).
create or replace function public.is_producer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('admin_festa', 'super_admin') and suspended_at is null
  );
$$;

alter table public.platform_settings add column if not exists ticket_hold_minutes int not null default 10
  check (ticket_hold_minutes between 5 and 30);

-- ---------------------------------------------------------------------
-- Eventos: dono, local próprio, capacidade, status e visibilidade
-- ---------------------------------------------------------------------
alter table public.events alter column venue_id drop not null;
alter table public.events add column if not exists producer_id   uuid references public.profiles (id) on delete set null;
alter table public.events add column if not exists location_name text check (char_length(location_name) <= 140);
alter table public.events add column if not exists address       text check (char_length(address) <= 240);
alter table public.events add column if not exists city          text check (char_length(city) <= 80);
alter table public.events add column if not exists state         text check (state is null or char_length(state) = 2);
alter table public.events add column if not exists category      text not null default 'festa' check (category in ('boate', 'festa', 'festival', 'experiencia'));
alter table public.events add column if not exists gallery       text[] not null default '{}';
alter table public.events add column if not exists capacity      int check (capacity is null or capacity > 0);
alter table public.events add column if not exists status        text not null default 'published' check (status in ('draft', 'published', 'cancelled', 'suspended'));
alter table public.events add column if not exists visibility    text not null default 'visible' check (visibility in ('hidden', 'partial', 'visible'));
alter table public.events add column if not exists hide_price    boolean not null default false;
alter table public.events add column if not exists hide_location boolean not null default false;
alter table public.events add column if not exists hide_name     boolean not null default false;
alter table public.events add column if not exists hide_capacity boolean not null default false;
alter table public.events add column if not exists vip_limit     int check (vip_limit is null or vip_limit > 0);
alter table public.events add column if not exists updated_at    timestamptz not null default now();
alter table public.events drop constraint if exists events_location_required;
alter table public.events add constraint events_location_required check (venue_id is not null or city is not null);
create index if not exists events_producer_idx on public.events (producer_id);
create index if not exists events_public_idx on public.events (status, visibility, event_date);

-- Campos que só o super admin altera; dono forçado no insert do produtor.
create or replace function public.protect_event_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.venues;
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.producer_id := auth.uid();
      new.visibility := 'visible';
      new.hide_price := false; new.hide_location := false; new.hide_name := false; new.hide_capacity := false;
      new.is_demo := false;
      if new.status = 'suspended' then new.status := 'draft'; end if;
    else
      new.producer_id := old.producer_id;
      new.visibility := old.visibility;
      new.hide_price := old.hide_price; new.hide_location := old.hide_location;
      new.hide_name := old.hide_name; new.hide_capacity := old.hide_capacity;
      new.is_demo := old.is_demo;
      new.created_at := old.created_at;
      -- Produtor não suspende nem reativa uma festa suspensa.
      if old.status = 'suspended' or new.status = 'suspended' then new.status := old.status; end if;
    end if;
  end if;
  -- Cidade/UF herdadas da casa quando não informadas.
  if new.venue_id is not null and (new.city is null or new.state is null) then
    select * into v from public.venues where id = new.venue_id;
    new.city := coalesce(new.city, v.city);
    new.state := coalesce(new.state, v.state);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_event_fields on public.events;
create trigger protect_event_fields before insert or update on public.events
  for each row execute function public.protect_event_fields();

-- Produtor dono da festa (ativo) OU super admin.
create or replace function public.owns_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.events e
      join public.profiles p on p.id = e.producer_id
     where e.id = p_event and e.producer_id = auth.uid()
       and p.role in ('admin_festa', 'super_admin') and p.suspended_at is null
  );
$$;

-- Festa visível ao público (listagens, busca, sitemap, página).
create or replace function public.event_is_public(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
      left join public.profiles p on p.id = e.producer_id
     where e.id = p_event and e.status = 'published' and e.visibility <> 'hidden'
       and (e.producer_id is null or p.suspended_at is null)
  );
$$;

-- ---------------------------------------------------------------------
-- Lotes
-- ---------------------------------------------------------------------
create table if not exists public.ticket_batches (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  ticket_type   text not null default 'pista' check (ticket_type in ('pista', 'vip', 'camarote', 'meia', 'outro')),
  price         numeric(10,2) not null check (price >= 1),
  quantity      int not null check (quantity between 1 and 100000),
  sort_order    int not null default 0,
  sales_start   timestamptz,
  sales_end     timestamptz,
  status        text not null default 'active' check (status in ('active', 'paused', 'closed')),
  max_per_order int not null default 10 check (max_per_order between 1 and 10),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (sales_start is null or sales_end is null or sales_end > sales_start)
);
create index if not exists ticket_batches_event_idx on public.ticket_batches (event_id, ticket_type, sort_order);
drop trigger if exists ticket_batches_touch on public.ticket_batches;
create trigger ticket_batches_touch before update on public.ticket_batches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Pedidos, itens, ingressos, pagamentos, webhooks
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete restrict,
  user_id        uuid not null references public.profiles (id) on delete restrict,
  buyer_name     text not null check (char_length(buyer_name) between 3 and 120),
  buyer_cpf      text not null check (buyer_cpf ~ '^[0-9]{11}$'),
  buyer_email    text not null check (char_length(buyer_email) <= 254 and buyer_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  buyer_phone    text not null check (buyer_phone ~ '^[0-9]{10,13}$'),
  status         text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled', 'refunded', 'charged_back')),
  total          numeric(10,2) not null check (total > 0),
  expires_at     timestamptz not null,
  payment_method text,           -- pix | credit_card | ticket (boleto) | ...
  installments   int,
  mp_payment_id  text,           -- último pagamento associado
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists orders_event_idx on public.orders (event_id, status);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_pending_idx on public.orders (expires_at) where status = 'pending';
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  batch_id   uuid not null references public.ticket_batches (id) on delete restrict,
  quantity   int not null check (quantity between 1 and 10),
  unit_price numeric(10,2) not null check (unit_price >= 0)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_batch_idx on public.order_items (batch_id);

create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete restrict,
  batch_id      uuid not null references public.ticket_batches (id) on delete restrict,
  user_id       uuid not null references public.profiles (id) on delete restrict,
  holder_name   text not null,
  -- Código do QR: 80 bits aleatórios (impossível de adivinhar), único.
  code          text not null unique default ('NO' || upper(encode(gen_random_bytes(10), 'hex'))),
  status        text not null default 'valid' check (status in ('valid', 'used', 'cancelled')),
  used_at       timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null,
  emailed_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists tickets_user_idx on public.tickets (user_id, created_at desc);
create index if not exists tickets_event_idx on public.tickets (event_id, status);
create index if not exists tickets_order_idx on public.tickets (order_id);

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  provider            text not null default 'mercadopago',
  provider_payment_id text not null,
  status              text not null,
  status_detail       text,
  payment_type        text,        -- credit_card | bank_transfer (pix) | ticket (boleto)
  payment_method      text,        -- visa | master | pix | bolbradesco ...
  installments        int,
  gross_amount        numeric(10,2) not null default 0,
  fee_amount          numeric(10,2) not null default 0,
  net_amount          numeric(10,2) not null default 0,
  live_mode           boolean,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index if not exists payments_order_idx on public.payments (order_id);
drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();

-- Idempotência das notificações (x-request-id / chave derivada).
create table if not exists public.webhook_events (
  id           bigint generated always as identity primary key,
  provider     text not null default 'mercadopago',
  event_key    text not null,
  topic        text,
  resource_id  text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  result       text,
  unique (provider, event_key)
);

-- ---------------------------------------------------------------------
-- Lista VIP e check-in
-- ---------------------------------------------------------------------
create table if not exists public.vip_list (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  name          text not null check (char_length(name) between 2 and 120),
  cpf           text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  email         text check (email is null or char_length(email) <= 254),
  phone         text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  note          text not null default '' check (char_length(note) <= 300),
  status        text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  source        text not null default 'manual' check (source in ('manual', 'csv', 'link')),
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null,
  added_by      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists vip_list_event_idx on public.vip_list (event_id, status);

create table if not exists public.vip_signup_links (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  max_entries int check (max_entries is null or max_entries > 0),
  active      boolean not null default true,
  expires_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists vip_links_event_idx on public.vip_signup_links (event_id);

alter table public.vip_list add column if not exists link_id uuid references public.vip_signup_links (id) on delete set null;

create table if not exists public.checkins (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  ticket_id     uuid unique references public.tickets (id) on delete cascade,
  vip_id        uuid unique references public.vip_list (id) on delete cascade,
  method        text not null default 'qr' check (method in ('qr', 'search', 'vip')),
  checked_in_by uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((ticket_id is null) <> (vip_id is null))
);
create index if not exists checkins_event_idx on public.checkins (event_id, created_at desc);

-- Limite opcional da lista VIP (pendentes + aprovados).
create or replace function public.enforce_vip_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  select vip_limit into lim from public.events where id = new.event_id for update;
  if lim is not null and new.status <> 'rejected' then
    select count(*) into n from public.vip_list where event_id = new.event_id and status <> 'rejected' and id <> new.id;
    if n >= lim then raise exception 'A lista VIP atingiu o limite de % nomes.', lim; end if;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then new.added_by := coalesce(new.added_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists enforce_vip_limit on public.vip_list;
create trigger enforce_vip_limit before insert or update of status on public.vip_list
  for each row execute function public.enforce_vip_limit();

-- ---------------------------------------------------------------------
-- Validação de CPF (dígitos verificadores) — espelha src/lib/cpf.ts
-- ---------------------------------------------------------------------
create or replace function public.valid_cpf(p text)
returns boolean language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if char_length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

-- ---------------------------------------------------------------------
-- Estoque por lote e liberação automática do próximo lote
--
-- Para cada TIPO (pista, VIP, camarote, meia), os lotes seguem sort_order.
-- Um lote "passou" quando está esgotado, encerrado (closed) ou depois de
-- sales_end. Só o primeiro lote que ainda não passou pode vender; ele vende
-- se estiver ativo e dentro da janela. Pausar um lote segura a fila daquele
-- tipo (para avançar, encerre o lote). Reservas válidas contam como vendidas.
-- ---------------------------------------------------------------------
create or replace function public.batch_stock(p_event uuid)
returns table (
  batch_id uuid, ticket_type text, name text, price numeric, quantity int, sold int, reserved int,
  available int, sales_start timestamptz, sales_end timestamptz, status text, sort_order int,
  max_per_order int, state text
) language sql stable security definer set search_path = public as $$
with b as (select * from public.ticket_batches where event_id = p_event),
c as (
  select oi.batch_id,
         coalesce(sum(oi.quantity) filter (where o.status = 'paid'), 0)::int as sold,
         coalesce(sum(oi.quantity) filter (where o.status = 'pending' and o.expires_at > now()), 0)::int as reserved
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.event_id = p_event
   group by oi.batch_id
),
x as (
  select b.*, coalesce(c.sold, 0) as sold_n, coalesce(c.reserved, 0) as reserved_n,
         greatest(b.quantity - coalesce(c.sold, 0) - coalesce(c.reserved, 0), 0) as avail,
         (b.status = 'closed' or (b.sales_end is not null and b.sales_end <= now())
          or b.quantity - coalesce(c.sold, 0) - coalesce(c.reserved, 0) <= 0) as done
    from b left join c on c.batch_id = b.id
),
y as (
  select x.*, bool_and(x.done) over (partition by x.ticket_type order by x.sort_order, x.created_at
                                     rows between unbounded preceding and 1 preceding) as prev_done
    from x
)
select y.id, y.ticket_type, y.name, y.price, y.quantity, y.sold_n, y.reserved_n, y.avail::int,
       y.sales_start, y.sales_end, y.status, y.sort_order, y.max_per_order,
       case
         when y.status = 'closed' then 'closed'
         when y.sales_end is not null and y.sales_end <= now() then 'ended'
         when y.avail <= 0 then case when y.reserved_n > 0 then 'reserved_out' else 'sold_out' end
         when coalesce(y.prev_done, true) = false then 'waiting'
         when y.status = 'paused' then 'paused'
         when y.sales_start is not null and y.sales_start > now() then 'upcoming'
         else 'on_sale'
       end
  from y
 order by y.ticket_type, y.sort_order, y.created_at;
$$;
revoke execute on function public.batch_stock(uuid) from public, anon, authenticated;

-- Totais vendidos/reservados de uma festa (capacidade).
create or replace function public.event_ticket_totals(p_event uuid)
returns table (sold int, reserved int)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(oi.quantity) filter (where o.status = 'paid'), 0)::int,
         coalesce(sum(oi.quantity) filter (where o.status = 'pending' and o.expires_at > now()), 0)::int
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.event_id = p_event;
$$;
revoke execute on function public.event_ticket_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- VIEW PÚBLICA — os campos ocultos saem como NULL (filtro no banco).
-- O dono da view (postgres) lê events; anon/authenticated só leem a view.
-- security_barrier impede que filtros do cliente sondem valores ocultos.
-- ---------------------------------------------------------------------
drop view if exists public.public_events;
create view public.public_events with (security_barrier = true) as
select
  e.id,
  case when h.name then e.id::text else e.slug end                              as slug,
  case when h.name then null else e.name end                                   as name,
  e.description,
  e.cover_image,
  e.gallery,
  e.event_date,
  e.start_time,
  e.category,
  case when h.price then null else coalesce(mp.min_price, e.ticket_price) end  as ticket_price,
  case when h.location then null else e.ticket_url end                         as ticket_url,
  case when h.location then null else e.venue_id end                           as venue_id,
  case when h.location then null else coalesce(e.location_name, v.name) end    as location_name,
  case when h.location then null else coalesce(e.address, v.address) end       as address,
  coalesce(e.city, v.city)                                                     as city,
  coalesce(e.state, v.state)                                                   as state,
  case when h.capacity then null else e.capacity end                           as capacity,
  case when h.capacity then null else coalesce(st.sold, 0) end                 as tickets_sold,
  e.dj_names,
  e.music_styles,
  e.is_demo,
  e.created_at,
  h.name     as name_hidden,
  h.price    as price_hidden,
  h.location as location_hidden,
  h.capacity as capacity_hidden,
  exists (select 1 from public.ticket_batches b where b.event_id = e.id and b.status <> 'closed') as has_tickets
from public.events e
left join public.venues v on v.id = e.venue_id
left join public.profiles p on p.id = e.producer_id
cross join lateral (
  select e.visibility = 'partial' and e.hide_name     as name,
         e.visibility = 'partial' and e.hide_price    as price,
         e.visibility = 'partial' and e.hide_location as location,
         e.visibility = 'partial' and e.hide_capacity as capacity
) h
left join lateral (
  select min(b.price) as min_price from public.ticket_batches b where b.event_id = e.id and b.status = 'active'
) mp on true
left join lateral (
  select sum(oi.quantity)::int as sold
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.event_id = e.id and o.status = 'paid'
) st on true
where e.status = 'published'
  and e.visibility <> 'hidden'
  and (e.producer_id is null or p.suspended_at is null);

revoke all on public.public_events from public;
grant select on public.public_events to anon, authenticated, service_role;

-- Lotes de uma festa pública (preço/estoque mascarados conforme a visibilidade).
create or replace function public.public_event_batches(p_event uuid)
returns table (batch_id uuid, ticket_type text, name text, price numeric, available int, sales_start timestamptz,
               sales_end timestamptz, state text, max_per_order int, sales_locked boolean)
language plpgsql stable security definer set search_path = public as $$
declare e public.events; hp boolean; hc boolean;
begin
  if not public.event_is_public(p_event) then return; end if;
  select * into e from public.events where id = p_event;
  hp := e.visibility = 'partial' and e.hide_price;
  hc := e.visibility = 'partial' and e.hide_capacity;
  return query
    select s.batch_id, s.ticket_type, s.name,
           case when hp then null else s.price end,
           case when hc then null else s.available end,
           s.sales_start, s.sales_end, s.state, s.max_per_order,
           hp or e.event_date < (now() at time zone 'America/Sao_Paulo')::date
      from public.batch_stock(p_event) s
     where s.status <> 'closed' or s.sold > 0;
end $$;
grant execute on function public.public_event_batches(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- RESERVA (checkout): trava a festa, confere estoque/lote/capacidade e cria
-- um pedido pendente que segura os ingressos por ticket_hold_minutes.
-- ---------------------------------------------------------------------
create or replace function public.reserve_order(p_event uuid, p_items jsonb, p_buyer jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  e public.events;
  hold int;
  v_name text := btrim(coalesce(p_buyer->>'name', ''));
  v_cpf text := regexp_replace(coalesce(p_buyer->>'cpf', ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_buyer->>'email', '')));
  v_phone text := regexp_replace(coalesce(p_buyer->>'phone', ''), '\D', '', 'g');
  it jsonb;
  s record;
  qty int;
  total_qty int := 0;
  total numeric := 0;
  t record;
  o public.orders;
  open_orders int;
begin
  if uid is null then raise exception 'Entre na sua conta para comprar.'; end if;
  if char_length(v_name) < 3 or v_name !~ '\s' then raise exception 'Informe o nome completo.'; end if;
  if not public.valid_cpf(v_cpf) then raise exception 'CPF inválido.'; end if;
  if v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'E-mail inválido.'; end if;
  if char_length(v_phone) not between 10 and 13 then raise exception 'Celular inválido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Escolha ao menos um ingresso.'; end if;

  -- Trava a festa: reservas da mesma festa são processadas uma por vez.
  select * into e from public.events where id = p_event for update;
  if not found or not public.event_is_public(p_event) then raise exception 'Evento indisponível.'; end if;
  if e.visibility = 'partial' and e.hide_price then raise exception 'As vendas deste evento abrem em breve.'; end if;
  if e.event_date < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Este evento já aconteceu.'; end if;

  -- Uma reserva aberta por pessoa e festa: a anterior (sem pagamento em andamento) é liberada.
  update public.orders set status = 'cancelled'
   where user_id = uid and event_id = p_event and status = 'pending' and mp_payment_id is null;
  select count(*) into open_orders from public.orders
   where user_id = uid and event_id = p_event and status = 'pending' and expires_at > now();
  if open_orders >= 3 then raise exception 'Você já tem pagamentos em andamento para este evento. Conclua-os ou aguarde.'; end if;

  -- Valida cada item contra o estoque calculado AGORA (com a festa travada).
  for it in select * from jsonb_array_elements(p_items) loop
    qty := coalesce((it->>'quantity')::int, 0);
    if qty < 1 then raise exception 'Quantidade inválida.'; end if;
    select * into s from public.batch_stock(p_event) b where b.batch_id = (it->>'batch_id')::uuid;
    if not found then raise exception 'Lote não encontrado.'; end if;
    if s.state <> 'on_sale' then raise exception 'O lote "%" não está à venda no momento.', s.name; end if;
    if qty > s.max_per_order then raise exception 'Máximo de % ingressos do lote "%" por pedido.', s.max_per_order, s.name; end if;
    if qty > s.available then raise exception 'Restam apenas % ingressos do lote "%".', s.available, s.name; end if;
    total_qty := total_qty + qty;
    total := total + qty * s.price;
  end loop;
  if total_qty > 10 then raise exception 'Máximo de 10 ingressos por pedido.'; end if;
  if (select count(distinct x->>'batch_id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'Itens duplicados.';
  end if;

  if e.capacity is not null then
    select * into t from public.event_ticket_totals(p_event);
    if t.sold + t.reserved + total_qty > e.capacity then
      raise exception 'Restam apenas % ingressos para este evento.', greatest(e.capacity - t.sold - t.reserved, 0);
    end if;
  end if;

  select ticket_hold_minutes into hold from public.platform_settings where id = 1;
  insert into public.orders (event_id, user_id, buyer_name, buyer_cpf, buyer_email, buyer_phone, total, expires_at)
       values (p_event, uid, left(v_name, 120), v_cpf, v_email, v_phone, total, now() + make_interval(mins => coalesce(hold, 10)))
    returning * into o;
  insert into public.order_items (order_id, batch_id, quantity, unit_price)
    select o.id, (x->>'batch_id')::uuid, (x->>'quantity')::int, b.price
      from jsonb_array_elements(p_items) x join public.ticket_batches b on b.id = (x->>'batch_id')::uuid;

  return json_build_object('order_id', o.id, 'total', o.total, 'expires_at', o.expires_at);
end $$;
revoke execute on function public.reserve_order(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.reserve_order(uuid, jsonb, jsonb) to authenticated;

-- Comprador desiste da reserva (libera o estoque na hora).
create or replace function public.cancel_my_order(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.orders set status = 'cancelled'
   where id = p_order and user_id = auth.uid() and status = 'pending' and mp_payment_id is null;
end $$;
revoke execute on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- APLICAÇÃO DO PAGAMENTO (somente servidor/service_role, chamada pelo
-- webhook e pela rota de pagamento depois de consultar a API do MP).
-- Idempotente: aplicar o mesmo pagamento duas vezes não emite em dobro.
-- ---------------------------------------------------------------------
create or replace function public.apply_payment(p_order uuid, p_payment jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  o public.orders;
  e public.events;
  v_status text := coalesce(p_payment->>'status', '');
  v_id text := p_payment->>'id';
  v_amount numeric := coalesce((p_payment->>'transaction_amount')::numeric, 0);
  v_hold timestamptz;
  it record;
  s record;
  t record;
  n int := 0;
  i int;
  qty_total int;
begin
  if v_id is null then raise exception 'Pagamento sem id.'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then return json_build_object('result', 'order_not_found'); end if;

  insert into public.payments (order_id, provider_payment_id, status, status_detail, payment_type, payment_method,
                               installments, gross_amount, fee_amount, net_amount, live_mode)
  values (o.id, v_id, v_status, p_payment->>'status_detail', p_payment->>'payment_type', p_payment->>'payment_method',
          (p_payment->>'installments')::int, v_amount, coalesce((p_payment->>'fee_amount')::numeric, 0),
          coalesce((p_payment->>'net_amount')::numeric, 0), (p_payment->>'live_mode')::boolean)
  on conflict (provider, provider_payment_id) do update set
    status = excluded.status, status_detail = excluded.status_detail, installments = excluded.installments,
    gross_amount = excluded.gross_amount, fee_amount = excluded.fee_amount, net_amount = excluded.net_amount;

  if v_status = 'approved' then
    if o.status = 'paid' then return json_build_object('result', 'already_paid'); end if;
    if o.status in ('refunded', 'charged_back') then return json_build_object('result', 'ignored'); end if;
    if abs(v_amount - o.total) > 0.01 then
      perform public.audit('payment.amount_mismatch', 'order', o.id::text,
        jsonb_build_object('expected', o.total, 'received', v_amount, 'payment_id', v_id), 'critical');
      return json_build_object('result', 'amount_mismatch');
    end if;

    -- Reserva vencida/cancelada: só emite se ainda houver estoque.
    if o.status <> 'pending' or o.expires_at <= now() then
      select * into e from public.events where id = o.event_id for update;
      for it in select * from public.order_items where order_id = o.id loop
        select * into s from public.batch_stock(o.event_id) b where b.batch_id = it.batch_id;
        if s.available < it.quantity then
          update public.orders set status = 'cancelled', mp_payment_id = v_id where id = o.id;
          perform public.audit('order.paid_without_stock', 'order', o.id::text, jsonb_build_object('payment_id', v_id), 'warning');
          return json_build_object('result', 'needs_refund');
        end if;
      end loop;
      if e.capacity is not null then
        select sum(quantity) into qty_total from public.order_items where order_id = o.id;
        select * into t from public.event_ticket_totals(o.event_id);
        if t.sold + t.reserved + qty_total > e.capacity then
          update public.orders set status = 'cancelled', mp_payment_id = v_id where id = o.id;
          return json_build_object('result', 'needs_refund');
        end if;
      end if;
    end if;

    update public.orders
       set status = 'paid', paid_at = now(), mp_payment_id = v_id,
           payment_method = coalesce(p_payment->>'payment_type', payment_method),
           installments = (p_payment->>'installments')::int
     where id = o.id;
    for it in select * from public.order_items where order_id = o.id loop
      for i in 1..it.quantity loop
        insert into public.tickets (order_id, order_item_id, event_id, batch_id, user_id, holder_name)
             values (o.id, it.id, o.event_id, it.batch_id, o.user_id, o.buyer_name);
        n := n + 1;
      end loop;
    end loop;
    perform public.audit('order.paid', 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'tickets', n, 'total', o.total));
    return json_build_object('result', 'issued', 'tickets', n);

  elsif v_status in ('pending', 'in_process', 'authorized') then
    if o.status = 'pending' then
      -- Pix/boleto: segura a reserva até o vencimento informado (máx. 4 dias).
      v_hold := least(coalesce((p_payment->>'date_of_expiration')::timestamptz, now() + interval '30 minutes'), now() + interval '4 days');
      update public.orders set mp_payment_id = v_id, expires_at = greatest(expires_at, v_hold),
             payment_method = coalesce(p_payment->>'payment_type', payment_method)
       where id = o.id;
    end if;
    return json_build_object('result', 'pending');

  elsif v_status = 'rejected' then
    -- Mantém a reserva até expirar para o comprador tentar outro meio.
    return json_build_object('result', 'rejected');

  elsif v_status in ('cancelled', 'expired') then
    if o.status = 'pending' and (o.mp_payment_id is null or o.mp_payment_id = v_id) then
      update public.orders set status = 'cancelled' where id = o.id;
    end if;
    return json_build_object('result', 'cancelled');

  elsif v_status in ('refunded', 'charged_back') then
    if o.status in ('paid', 'pending', 'cancelled') then
      update public.orders set status = v_status where id = o.id;
      update public.tickets set status = 'cancelled' where order_id = o.id and status = 'valid';
      perform public.audit('order.' || v_status, 'order', o.id::text, jsonb_build_object('payment_id', v_id), 'warning');
    end if;
    return json_build_object('result', 'refunded');
  end if;

  return json_build_object('result', 'unknown_status');
end $$;
revoke execute on function public.apply_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment(uuid, jsonb) to service_role;

-- Reservas vencidas viram "expired" (chamada pelo cron; a contagem de estoque
-- já ignora reservas vencidas mesmo sem o cron).
create or replace function public.expire_orders()
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.orders set status = 'expired' where status = 'pending' and expires_at < now() - interval '1 minute';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.expire_orders() from public, anon, authenticated;
grant execute on function public.expire_orders() to service_role;

-- ---------------------------------------------------------------------
-- CHECK-IN (portaria)
-- ---------------------------------------------------------------------
create or replace function public._checkin(t public.tickets, p_method text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare b public.ticket_batches;
begin
  select * into b from public.ticket_batches where id = t.batch_id;
  if t.status = 'cancelled' then
    return json_build_object('result', 'cancelled', 'holder_name', t.holder_name);
  end if;
  if t.status = 'used' then
    return json_build_object('result', 'already_used', 'used_at', t.used_at, 'holder_name', t.holder_name, 'batch', b.name);
  end if;
  update public.tickets set status = 'used', used_at = now(), checked_in_by = auth.uid() where id = t.id;
  insert into public.checkins (event_id, ticket_id, method, checked_in_by) values (t.event_id, t.id, p_method, auth.uid());
  return json_build_object('result', 'ok', 'holder_name', t.holder_name, 'batch', b.name, 'ticket_type', b.ticket_type, 'ticket_id', t.id);
end $$;
revoke execute on function public._checkin(public.tickets, text) from public, anon, authenticated;

create or replace function public.checkin_ticket(p_event uuid, p_code text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare t public.tickets;
begin
  if not public.owns_event(p_event) then raise exception 'Sem permissão para esta festa.'; end if;
  -- FOR UPDATE: duas leituras simultâneas do mesmo QR não passam as duas.
  select * into t from public.tickets where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return json_build_object('result', 'not_found'); end if;
  if t.event_id <> p_event then return json_build_object('result', 'wrong_event'); end if;
  return public._checkin(t, 'qr');
end $$;
revoke execute on function public.checkin_ticket(uuid, text) from public, anon;
grant execute on function public.checkin_ticket(uuid, text) to authenticated;

create or replace function public.checkin_ticket_id(p_ticket uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
declare t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket for update;
  if not found then return json_build_object('result', 'not_found'); end if;
  if not public.owns_event(t.event_id) then raise exception 'Sem permissão para esta festa.'; end if;
  return public._checkin(t, 'search');
end $$;
revoke execute on function public.checkin_ticket_id(uuid) from public, anon;
grant execute on function public.checkin_ticket_id(uuid) to authenticated;

create or replace function public.checkin_vip(p_vip uuid)
returns json language plpgsql volatile security definer set search_path = public as $$
declare v public.vip_list;
begin
  select * into v from public.vip_list where id = p_vip for update;
  if not found then return json_build_object('result', 'not_found'); end if;
  if not public.owns_event(v.event_id) then raise exception 'Sem permissão para esta festa.'; end if;
  if v.status <> 'approved' then return json_build_object('result', 'not_approved', 'holder_name', v.name); end if;
  if v.checked_in_at is not null then return json_build_object('result', 'already_used', 'used_at', v.checked_in_at, 'holder_name', v.name); end if;
  update public.vip_list set checked_in_at = now(), checked_in_by = auth.uid() where id = v.id;
  insert into public.checkins (event_id, vip_id, method, checked_in_by) values (v.event_id, v.id, 'vip', auth.uid());
  return json_build_object('result', 'ok', 'holder_name', v.name, 'batch', 'Lista VIP');
end $$;
revoke execute on function public.checkin_vip(uuid) from public, anon;
grant execute on function public.checkin_vip(uuid) to authenticated;

-- Busca por nome ou CPF (ingressos pagos + lista VIP aprovada).
create or replace function public.search_attendees(p_event uuid, p_query text)
returns table (kind text, id uuid, name text, cpf text, batch text, status text, used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_query, '')); digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  if not public.owns_event(p_event) then raise exception 'Sem permissão para esta festa.'; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select 'ticket'::text, t.id, t.holder_name, o.buyer_cpf, b.name, t.status, t.used_at
      from public.tickets t join public.orders o on o.id = t.order_id join public.ticket_batches b on b.id = t.batch_id
     where t.event_id = p_event
       and (t.holder_name ilike '%' || q || '%' or (char_length(digits) >= 3 and o.buyer_cpf like '%' || digits || '%') or t.code = upper(q))
    union all
    select 'vip'::text, v.id, v.name, v.cpf, 'Lista VIP'::text,
           case when v.checked_in_at is not null then 'used' else v.status end, v.checked_in_at
      from public.vip_list v
     where v.event_id = p_event and v.status <> 'rejected'
       and (v.name ilike '%' || q || '%' or (char_length(digits) >= 3 and coalesce(v.cpf, '') like '%' || digits || '%'))
    limit 30;
end $$;
revoke execute on function public.search_attendees(uuid, text) from public, anon;
grant execute on function public.search_attendees(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- LISTA VIP — inscrição pública por link (com aprovação do produtor)
-- ---------------------------------------------------------------------
create or replace function public.public_vip_link(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare l public.vip_signup_links; pe record; used int;
begin
  select * into l from public.vip_signup_links where token = p_token;
  if not found or not public.event_is_public(l.event_id) then return null; end if;
  select * into pe from public.public_events where id = l.event_id;
  select count(*) into used from public.vip_list where link_id = l.id and status <> 'rejected';
  return json_build_object(
    'event', json_build_object('id', pe.id, 'slug', pe.slug, 'name', pe.name, 'event_date', pe.event_date,
                               'start_time', pe.start_time, 'city', pe.city, 'state', pe.state, 'cover_image', pe.cover_image),
    'open', l.active and (l.expires_at is null or l.expires_at > now()) and (l.max_entries is null or used < l.max_entries)
  );
end $$;
grant execute on function public.public_vip_link(text) to anon, authenticated;

create or replace function public.vip_signup(p_token text, p_name text, p_email text, p_phone text, p_cpf text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare l public.vip_signup_links; used int; v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
        v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into l from public.vip_signup_links where token = p_token for update;
  if not found or not public.event_is_public(l.event_id) then raise exception 'Link inválido.'; end if;
  if not l.active or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'As inscrições nesta lista foram encerradas.'; end if;
  select count(*) into used from public.vip_list where link_id = l.id and status <> 'rejected';
  if l.max_entries is not null and used >= l.max_entries then raise exception 'A lista está completa.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Informe o nome completo.'; end if;
  if v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'E-mail inválido.'; end if;
  if v_cpf is not null and not public.valid_cpf(v_cpf) then raise exception 'CPF inválido.'; end if;
  if v_phone is not null and char_length(v_phone) not between 10 and 13 then raise exception 'Celular inválido.'; end if;
  if exists (select 1 from public.vip_list where event_id = l.event_id and lower(coalesce(email, '')) = v_email and status <> 'rejected') then
    return json_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.vip_list (event_id, name, cpf, email, phone, status, source, link_id)
       values (l.event_id, left(btrim(p_name), 120), v_cpf, v_email, v_phone, 'pending', 'link', l.id);
  return json_build_object('ok', true);
end $$;
grant execute on function public.vip_signup(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- PAINEL DO PRODUTOR — dashboard e relatório (somente dono ou super admin)
-- ---------------------------------------------------------------------
create or replace function public.producer_event_dashboard(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.events; r json;
begin
  if not public.owns_event(p_event) then raise exception 'Sem permissão para esta festa.'; end if;
  select * into e from public.events where id = p_event;
  select json_build_object(
    'capacity', e.capacity,
    'tickets_sold', coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id where o.event_id = p_event and o.status = 'paid'), 0),
    'tickets_reserved', coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id where o.event_id = p_event and o.status = 'pending' and o.expires_at > now()), 0),
    'orders_paid', (select count(*) from public.orders where event_id = p_event and status = 'paid'),
    'gross', coalesce((select sum(total) from public.orders where event_id = p_event and status = 'paid'), 0),
    'fees', coalesce((select sum(p.fee_amount) from public.payments p join public.orders o on o.id = p.order_id where o.event_id = p_event and o.status = 'paid' and p.status = 'approved'), 0),
    'checked_in', (select count(*) from public.tickets where event_id = p_event and status = 'used'),
    'vip_total', (select count(*) from public.vip_list where event_id = p_event and status = 'approved'),
    'vip_present', (select count(*) from public.vip_list where event_id = p_event and checked_in_at is not null),
    'vip_pending', (select count(*) from public.vip_list where event_id = p_event and status = 'pending'),
    'batches', coalesce((select json_agg(row_to_json(s)) from public.batch_stock(p_event) s), '[]'::json),
    'recent_orders', coalesce((select json_agg(x) from (
        select o.id, o.buyer_name, o.total, o.status, o.payment_method, o.created_at, o.paid_at
          from public.orders o where o.event_id = p_event and o.status <> 'cancelled'
         order by o.created_at desc limit 10) x), '[]'::json)
  ) into r;
  return r;
end $$;
revoke execute on function public.producer_event_dashboard(uuid) from public, anon;
grant execute on function public.producer_event_dashboard(uuid) to authenticated;

create or replace function public.producer_event_report(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare e public.events; r json;
begin
  if not public.owns_event(p_event) then raise exception 'Sem permissão para esta festa.'; end if;
  select * into e from public.events where id = p_event;
  select json_build_object(
    'event', json_build_object('id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time, 'capacity', e.capacity),
    'buyers', coalesce((select json_agg(x order by x.created_at) from (
        select o.id as order_id, o.buyer_name, o.buyer_cpf, o.buyer_email, o.buyer_phone,
               b.name as batch, b.ticket_type, oi.quantity, oi.unit_price, oi.quantity * oi.unit_price as amount,
               o.created_at, o.paid_at, o.status, o.payment_method, o.installments,
               (select count(*) from public.tickets t where t.order_item_id = oi.id and t.status = 'used') as checked_in,
               (select count(*) from public.tickets t where t.order_item_id = oi.id) as tickets
          from public.orders o join public.order_items oi on oi.order_id = o.id join public.ticket_batches b on b.id = oi.batch_id
         where o.event_id = p_event and o.status <> 'cancelled' and (o.status <> 'expired' or o.mp_payment_id is not null)) x), '[]'::json),
    'vip', coalesce((select json_agg(v order by v.name) from (
        select name, cpf, email, phone, note, status, source, checked_in_at, created_at
          from public.vip_list where event_id = p_event) v), '[]'::json),
    'revenue', json_build_object(
      'gross', coalesce((select sum(total) from public.orders where event_id = p_event and status = 'paid'), 0),
      'fees', coalesce((select sum(p.fee_amount) from public.payments p join public.orders o on o.id = p.order_id where o.event_id = p_event and o.status = 'paid' and p.status = 'approved'), 0),
      'net', coalesce((select sum(p.net_amount) from public.payments p join public.orders o on o.id = p.order_id where o.event_id = p_event and o.status = 'paid' and p.status = 'approved'), 0),
      'refunded', coalesce((select sum(total) from public.orders where event_id = p_event and status in ('refunded', 'charged_back')), 0),
      'by_batch', coalesce((select json_agg(x order by x.ticket_type, x.sort_order) from (
          select b.name as batch, b.ticket_type, b.sort_order, b.price, b.quantity,
                 coalesce(sum(oi.quantity) filter (where o.status = 'paid'), 0) as sold,
                 coalesce(sum(oi.quantity * oi.unit_price) filter (where o.status = 'paid'), 0) as gross
            from public.ticket_batches b left join public.order_items oi on oi.batch_id = b.id left join public.orders o on o.id = oi.order_id
           where b.event_id = p_event group by b.id) x), '[]'::json),
      'by_method', coalesce((select json_agg(x) from (
          select coalesce(o.payment_method, 'desconhecido') as method, count(distinct o.id) as orders,
                 sum((select sum(quantity) from public.order_items where order_id = o.id)) as tickets, sum(o.total) as gross
            from public.orders o where o.event_id = p_event and o.status = 'paid' group by 1) x), '[]'::json)
    ),
    'checkins', json_build_object(
      'tickets_used', (select count(*) from public.tickets where event_id = p_event and status = 'used'),
      'tickets_total', (select count(*) from public.tickets where event_id = p_event and status <> 'cancelled'),
      'vip_present', (select count(*) from public.vip_list where event_id = p_event and checked_in_at is not null),
      'vip_total', (select count(*) from public.vip_list where event_id = p_event and status = 'approved'))
  ) into r;
  perform public.audit('report.generated', 'event', p_event::text, '{}'::jsonb);
  return r;
end $$;
revoke execute on function public.producer_event_report(uuid) from public, anon;
grant execute on function public.producer_event_report(uuid) to authenticated;

-- Resumo das festas do produtor (super admin vê as próprias também).
create or replace function public.producer_overview()
returns table (event_id uuid, name text, slug text, event_date date, status text, visibility text, capacity int, sold int, gross numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.slug, e.event_date, e.status, e.visibility, e.capacity,
         coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id where o.event_id = e.id and o.status = 'paid'), 0)::int,
         coalesce((select sum(o.total) from public.orders o where o.event_id = e.id and o.status = 'paid'), 0)
    from public.events e
   where e.producer_id = auth.uid() and public.is_producer()
   order by e.event_date desc;
$$;
revoke execute on function public.producer_overview() from public, anon;
grant execute on function public.producer_overview() to authenticated;

-- ---------------------------------------------------------------------
-- SUPER ADMIN — visibilidade, suspensão, visão geral de vendas
-- ---------------------------------------------------------------------
create or replace function public.admin_set_event_visibility(
  p_event uuid, p_visibility text, p_hide_price boolean, p_hide_location boolean, p_hide_name boolean, p_hide_capacity boolean
) returns void language plpgsql volatile security definer set search_path = public as $$
declare old_e public.events;
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  if p_visibility not in ('hidden', 'partial', 'visible') then raise exception 'Visibilidade inválida.'; end if;
  select * into old_e from public.events where id = p_event for update;
  if not found then raise exception 'Festa não encontrada.'; end if;
  update public.events set visibility = p_visibility,
         hide_price = coalesce(p_hide_price, false), hide_location = coalesce(p_hide_location, false),
         hide_name = coalesce(p_hide_name, false), hide_capacity = coalesce(p_hide_capacity, false)
   where id = p_event;
  perform public.audit('event.visibility_changed', 'event', p_event::text, jsonb_build_object(
    'from', old_e.visibility, 'to', p_visibility, 'hide_price', p_hide_price, 'hide_location', p_hide_location,
    'hide_name', p_hide_name, 'hide_capacity', p_hide_capacity), 'warning');
end $$;
revoke execute on function public.admin_set_event_visibility(uuid, text, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_set_event_visibility(uuid, text, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.admin_set_event_status(p_event uuid, p_status text, p_reason text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
declare old_status text;
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  if p_status not in ('draft', 'published', 'cancelled', 'suspended') then raise exception 'Status inválido.'; end if;
  select status into old_status from public.events where id = p_event for update;
  if not found then raise exception 'Festa não encontrada.'; end if;
  update public.events set status = p_status where id = p_event;
  perform public.audit('event.status_changed', 'event', p_event::text,
    jsonb_build_object('from', old_status, 'to', p_status, 'reason', left(coalesce(p_reason, ''), 300)), 'warning');
end $$;
revoke execute on function public.admin_set_event_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_event_status(uuid, text, text) to authenticated;

create or replace function public.admin_set_user_suspended(p_user uuid, p_suspended boolean, p_reason text default '')
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode suspender a própria conta.'; end if;
  update public.profiles
     set suspended_at = case when p_suspended then now() else null end,
         suspended_reason = case when p_suspended then left(coalesce(p_reason, ''), 300) else null end
   where id = p_user;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  perform public.audit(case when p_suspended then 'user.suspended' else 'user.reactivated' end, 'profile', p_user::text,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 300)), 'critical');
end $$;
revoke execute on function public.admin_set_user_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_suspended(uuid, boolean, text) to authenticated;

create or replace function public.admin_events_overview()
returns table (event_id uuid, name text, slug text, event_date date, city text, status text, visibility text,
               hide_price boolean, hide_location boolean, hide_name boolean, hide_capacity boolean,
               producer_id uuid, producer_username text, producer_suspended boolean, capacity int, sold int, gross numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  return query
    select e.id, e.name, e.slug, e.event_date, coalesce(e.city, v.city), e.status, e.visibility,
           e.hide_price, e.hide_location, e.hide_name, e.hide_capacity,
           e.producer_id, p.username, p.suspended_at is not null, e.capacity,
           coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id where o.event_id = e.id and o.status = 'paid'), 0)::int,
           coalesce((select sum(o.total) from public.orders o where o.event_id = e.id and o.status = 'paid'), 0)
      from public.events e
      left join public.venues v on v.id = e.venue_id
      left join public.profiles p on p.id = e.producer_id
     order by e.event_date desc;
end $$;
revoke execute on function public.admin_events_overview() from public, anon;
grant execute on function public.admin_events_overview() to authenticated;

create or replace function public.admin_producers()
returns table (id uuid, username text, full_name text, contact text, role text, suspended_at timestamptz,
               suspended_reason text, events int, sold int, gross numeric)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  return query
    select p.id, p.username, p.full_name, coalesce(u.email, u.phone)::text, p.role, p.suspended_at, p.suspended_reason,
           (select count(*) from public.events e where e.producer_id = p.id)::int,
           coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id join public.events e on e.id = o.event_id where e.producer_id = p.id and o.status = 'paid'), 0)::int,
           coalesce((select sum(o.total) from public.orders o join public.events e on e.id = o.event_id where e.producer_id = p.id and o.status = 'paid'), 0)
      from public.profiles p join auth.users u on u.id = p.id
     where p.role in ('admin_festa', 'super_admin')
     order by p.username;
end $$;
revoke execute on function public.admin_producers() from public, anon;
grant execute on function public.admin_producers() to authenticated;

create or replace function public.admin_sales(p_limit int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito ao super admin.'; end if;
  return json_build_object(
    'totals', json_build_object(
      'gross', coalesce((select sum(total) from public.orders where status = 'paid'), 0),
      'fees', coalesce((select sum(p.fee_amount) from public.payments p join public.orders o on o.id = p.order_id where o.status = 'paid' and p.status = 'approved'), 0),
      'orders', (select count(*) from public.orders where status = 'paid'),
      'tickets', (select count(*) from public.tickets where status <> 'cancelled'),
      'refunded', coalesce((select sum(total) from public.orders where status in ('refunded', 'charged_back')), 0)),
    'orders', coalesce((select json_agg(x) from (
        select o.id, o.buyer_name, o.buyer_email, o.total, o.status, o.payment_method, o.created_at, o.paid_at,
               e.name as event_name, e.id as event_id
          from public.orders o join public.events e on e.id = o.event_id
         where o.status <> 'cancelled'
         order by o.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::json)
  );
end $$;
revoke execute on function public.admin_sales(int) from public, anon;
grant execute on function public.admin_sales(int) to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria de festas e lotes (alterações feitas por produtores/admin)
-- ---------------------------------------------------------------------
create or replace function public.audit_event_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare changed text[];
begin
  if auth.uid() is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.audit('event.created', 'event', new.id::text, jsonb_build_object('name', new.name, 'status', new.status));
  else
    select coalesce(array_agg(n.key), '{}') into changed
      from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if cardinality(changed) > 0 then
      perform public.audit('event.updated', 'event', new.id::text, jsonb_build_object('name', new.name, 'fields', changed));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists audit_event_change on public.events;
create trigger audit_event_change after insert or update on public.events
  for each row execute function public.audit_event_change();

create or replace function public.audit_batch_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.ticket_batches := coalesce(new, old);
begin
  if auth.uid() is null then return null; end if;
  perform public.audit('batch.' || lower(tg_op), 'event', r.event_id::text, jsonb_build_object(
    'batch_id', r.id, 'name', r.name, 'price', r.price, 'quantity', r.quantity, 'status', r.status,
    'sales_start', r.sales_start, 'sales_end', r.sales_end));
  return null;
end $$;
drop trigger if exists audit_batch_change on public.ticket_batches;
create trigger audit_batch_change after insert or update or delete on public.ticket_batches
  for each row execute function public.audit_batch_change();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.ticket_batches enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tickets enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.vip_list enable row level security;
alter table public.vip_signup_links enable row level security;
alter table public.checkins enable row level security;

-- events: o público NÃO lê a tabela (só a view public_events).
drop policy if exists "events read" on public.events;
drop policy if exists "events admin write" on public.events;
drop policy if exists "events owner read" on public.events;
create policy "events owner read" on public.events for select to authenticated
  using (public.is_admin() or producer_id = auth.uid());
drop policy if exists "events admin all" on public.events;
create policy "events admin all" on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "events producer insert" on public.events;
create policy "events producer insert" on public.events for insert to authenticated
  with check (public.is_producer() and producer_id = auth.uid());
drop policy if exists "events producer update" on public.events;
create policy "events producer update" on public.events for update to authenticated
  using (public.is_producer() and producer_id = auth.uid()) with check (producer_id = auth.uid());
drop policy if exists "events producer delete" on public.events;
create policy "events producer delete" on public.events for delete to authenticated
  using (public.is_producer() and producer_id = auth.uid()
         and not exists (select 1 from public.orders o where o.event_id = events.id));
revoke select on public.events from anon;

-- Lotes: somente dono/super admin (o público usa public_event_batches()).
drop policy if exists "batches owner" on public.ticket_batches;
create policy "batches owner" on public.ticket_batches for all to authenticated
  using (public.owns_event(event_id)) with check (public.owns_event(event_id));

-- Pedidos/itens/ingressos: comprador vê os próprios; dono da festa e super admin veem os da festa.
-- Escrita só pelas funções security definer (reserve_order, apply_payment, check-in).
drop policy if exists "orders read" on public.orders;
create policy "orders read" on public.orders for select to authenticated
  using (user_id = auth.uid() or public.owns_event(event_id));
drop policy if exists "order items read" on public.order_items;
create policy "order items read" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.owns_event(o.event_id))));
drop policy if exists "tickets read" on public.tickets;
create policy "tickets read" on public.tickets for select to authenticated
  using (user_id = auth.uid() or public.owns_event(event_id));
drop policy if exists "payments read" on public.payments;
create policy "payments read" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.owns_event(o.event_id))));

-- Lista VIP / links / check-ins: dono da festa e super admin.
drop policy if exists "vip owner" on public.vip_list;
create policy "vip owner" on public.vip_list for all to authenticated
  using (public.owns_event(event_id)) with check (public.owns_event(event_id));
drop policy if exists "vip links owner" on public.vip_signup_links;
create policy "vip links owner" on public.vip_signup_links for all to authenticated
  using (public.owns_event(event_id)) with check (public.owns_event(event_id));
drop policy if exists "checkins owner read" on public.checkins;
create policy "checkins owner read" on public.checkins for select to authenticated
  using (public.owns_event(event_id));

-- webhook_events: sem políticas (somente service_role).
revoke all on public.orders, public.order_items, public.tickets, public.payments, public.webhook_events,
              public.vip_list, public.vip_signup_links, public.checkins, public.ticket_batches from anon;
revoke insert, update, delete on public.orders, public.order_items, public.tickets, public.payments, public.checkins from authenticated;

-- Tempo real no painel do produtor (Realtime respeita a RLS acima).
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- Storage: imagens das festas (produtor sobe na própria pasta)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('event-images', 'event-images', true) on conflict (id) do nothing;

drop policy if exists "public read event images" on storage.objects;
create policy "public read event images" on storage.objects for select using (bucket_id = 'event-images');
drop policy if exists "producers upload event images" on storage.objects;
create policy "producers upload event images" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-images' and public.is_producer() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "producers manage event images" on storage.objects;
create policy "producers manage event images" on storage.objects for delete to authenticated
  using (bucket_id = 'event-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- Dados demo: remover também pedidos/ingressos de festas demonstrativas
-- ---------------------------------------------------------------------
create or replace function public.remove_demo_data()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  delete from public.orders where event_id in (select id from public.events where is_demo);
  delete from public.events where is_demo;
  delete from public.venues where is_demo;
  delete from public.venue_reviews where is_demo;
  delete from public.event_reviews where is_demo;
  delete from auth.users where coalesce((raw_app_meta_data->>'demo')::boolean, false) and id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000');
end $$;
revoke execute on function public.remove_demo_data() from anon;
