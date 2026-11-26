-- =====================================================================
-- NO OFF — GATEWAY PURINCASH (Pix + cartão). Execute depois de 0001–0006.
-- Idempotente. NÃO apaga dados do Mercado Pago: pedidos/pagamentos antigos
-- continuam válidos (provider = 'mercadopago', mp_payment_id preservado).
--
--   orders.provider / provider_payment_id / provider_method
--       cobrança ATUAL do pedido (psc_... no Pix, orderCode no cartão)
--   payments.* (pix_brcode, pix_qr_image, checkout_url, provider_expires_at,
--       amount_cents, environment, paid_at, checked_at)
--       uma linha por cobrança criada — permite reutilizar a cobrança pendente
--       e achar o pedido a partir do paymentId/orderCode do webhook
--   purincash_webhook_events
--       deduplicação por X-Webhook-Id (unique)
--   apply_payment()
--       aceita provider = 'purincash' e confere amount_cents com o total do
--       pedido (diferente → amount_mismatch + auditoria crítica, sem ingresso)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas de provedor
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists provider            text;
alter table public.orders add column if not exists provider_payment_id text;
alter table public.orders add column if not exists provider_method     text;
alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider is null or provider in ('mercadopago', 'purincash'));
alter table public.orders drop constraint if exists orders_provider_method_check;
alter table public.orders add constraint orders_provider_method_check check (provider_method is null or provider_method in ('pix', 'card'));

-- Pedidos antigos do Mercado Pago passam a usar a coluna genérica (mp_payment_id fica intacto).
update public.orders
   set provider = 'mercadopago', provider_payment_id = mp_payment_id
 where mp_payment_id is not null and provider_payment_id is null;
create index if not exists orders_provider_payment_idx on public.orders (provider, provider_payment_id) where provider_payment_id is not null;

alter table public.payments add column if not exists amount_cents        bigint;
alter table public.payments add column if not exists pix_brcode          text check (pix_brcode is null or char_length(pix_brcode) <= 2000);
alter table public.payments add column if not exists pix_qr_image        text check (pix_qr_image is null or char_length(pix_qr_image) <= 200000);
alter table public.payments add column if not exists checkout_url        text check (checkout_url is null or char_length(checkout_url) <= 1000);
alter table public.payments add column if not exists provider_expires_at timestamptz;
alter table public.payments add column if not exists environment         text;
alter table public.payments add column if not exists paid_at             timestamptz;
alter table public.payments add column if not exists checked_at          timestamptz;
alter table public.payments drop constraint if exists payments_environment_check;
alter table public.payments add constraint payments_environment_check check (environment is null or environment in ('live', 'sandbox'));
alter table public.payments alter column provider set default 'purincash';
create index if not exists payments_order_pending_idx on public.payments (order_id, provider, payment_method) where status = 'pending';

-- ---------------------------------------------------------------------
-- Webhooks do PurinCash: o mesmo X-Webhook-Id é processado uma única vez
-- ---------------------------------------------------------------------
create table if not exists public.purincash_webhook_events (
  id           bigint generated always as identity primary key,
  webhook_id   text not null unique check (char_length(webhook_id) <= 200),
  event        text check (char_length(event) <= 80),
  resource_id  text check (char_length(resource_id) <= 120),
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  result       text check (char_length(result) <= 60)
);
create index if not exists purincash_webhook_events_received_idx on public.purincash_webhook_events (received_at desc);
alter table public.purincash_webhook_events enable row level security;
-- Sem políticas: somente service_role.
revoke all on public.purincash_webhook_events from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- APLICAÇÃO DO PAGAMENTO (somente service_role). Idempotente.
--   p_payment: { provider, id, status, amount_cents | transaction_amount,
--                payment_type, payment_method, method, pix_brcode, pix_qr_image,
--                checkout_url, provider_expires_at, date_of_expiration,
--                environment, live_mode, paid_at, register }
--   Status PurinCash: paid → approved, failed → rejected; pending/expired/refunded iguais.
-- ---------------------------------------------------------------------
create or replace function public.apply_payment(p_order uuid, p_payment jsonb)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  o public.orders;
  e public.events;
  v_provider text := coalesce(nullif(p_payment->>'provider', ''), 'mercadopago');
  v_raw text := coalesce(p_payment->>'status', '');
  v_status text;
  v_id text := nullif(p_payment->>'id', '');
  v_cents bigint := nullif(p_payment->>'amount_cents', '')::bigint;
  v_amount numeric;
  v_method text := nullif(p_payment->>'method', '');
  v_register boolean := coalesce((p_payment->>'register')::boolean, false);
  v_hold timestamptz;
  v_mine boolean;
  it record;
  s record;
  t record;
  n int := 0;
  i int;
  qty_total int;
begin
  if v_id is null then raise exception 'Pagamento sem id.'; end if;
  if v_provider not in ('mercadopago', 'purincash') then raise exception 'Provedor de pagamento inválido.'; end if;
  if v_method is not null and v_method not in ('pix', 'card') then v_method := null; end if;
  v_status := case
    when v_provider = 'purincash' then case v_raw when 'paid' then 'approved' when 'failed' then 'rejected' else v_raw end
    else v_raw end;
  v_amount := coalesce(v_cents / 100.0, (p_payment->>'transaction_amount')::numeric, 0);

  select * into o from public.orders where id = p_order for update;
  if not found then return json_build_object('result', 'order_not_found'); end if;

  -- A mesma cobrança nunca pode ser aplicada a outro pedido.
  if exists (select 1 from public.payments where provider = v_provider and provider_payment_id = v_id and order_id <> o.id) then
    perform public.audit('payment.order_mismatch', 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider), 'critical');
    return json_build_object('result', 'order_not_found');
  end if;

  insert into public.payments (order_id, provider, provider_payment_id, status, status_detail, payment_type, payment_method,
                               installments, gross_amount, fee_amount, net_amount, live_mode, amount_cents, pix_brcode,
                               pix_qr_image, checkout_url, provider_expires_at, environment, paid_at, checked_at)
  values (o.id, v_provider, v_id, v_status, p_payment->>'status_detail', p_payment->>'payment_type', p_payment->>'payment_method',
          (p_payment->>'installments')::int, v_amount, coalesce((p_payment->>'fee_amount')::numeric, 0),
          coalesce((p_payment->>'net_amount')::numeric, v_amount), (p_payment->>'live_mode')::boolean, v_cents,
          nullif(p_payment->>'pix_brcode', ''), nullif(p_payment->>'pix_qr_image', ''), nullif(p_payment->>'checkout_url', ''),
          nullif(p_payment->>'provider_expires_at', '')::timestamptz, nullif(p_payment->>'environment', ''),
          nullif(p_payment->>'paid_at', '')::timestamptz, now())
  on conflict (provider, provider_payment_id) do update set
    status              = excluded.status,
    status_detail       = coalesce(excluded.status_detail, payments.status_detail),
    payment_type        = coalesce(excluded.payment_type, payments.payment_type),
    payment_method      = coalesce(excluded.payment_method, payments.payment_method),
    installments        = coalesce(excluded.installments, payments.installments),
    gross_amount        = excluded.gross_amount,
    fee_amount          = excluded.fee_amount,
    net_amount          = excluded.net_amount,
    amount_cents        = coalesce(excluded.amount_cents, payments.amount_cents),
    pix_brcode          = coalesce(excluded.pix_brcode, payments.pix_brcode),
    pix_qr_image        = coalesce(excluded.pix_qr_image, payments.pix_qr_image),
    checkout_url        = coalesce(excluded.checkout_url, payments.checkout_url),
    provider_expires_at = coalesce(excluded.provider_expires_at, payments.provider_expires_at),
    environment         = coalesce(excluded.environment, payments.environment),
    paid_at             = coalesce(excluded.paid_at, payments.paid_at),
    checked_at          = now();

  -- Cobrança "atual" do pedido (ou o pedido ainda não tem nenhuma).
  v_mine := o.provider_payment_id is null or o.provider_payment_id = v_id;

  if v_status = 'approved' then
    if o.status = 'paid' then return json_build_object('result', 'already_paid'); end if;
    if o.status in ('refunded', 'charged_back') then return json_build_object('result', 'ignored'); end if;
    -- Valor pago diferente do total do pedido: NÃO emite e alerta.
    if (v_cents is not null and v_cents <> round(o.total * 100)::bigint) or (v_cents is null and abs(v_amount - o.total) > 0.01) then
      update public.payments set status = 'amount_mismatch' where provider = v_provider and provider_payment_id = v_id;
      perform public.audit('payment.amount_mismatch', 'order', o.id::text, jsonb_build_object(
        'expected_cents', round(o.total * 100)::bigint, 'received_cents', coalesce(v_cents, round(v_amount * 100)::bigint),
        'payment_id', v_id, 'provider', v_provider), 'critical');
      return json_build_object('result', 'amount_mismatch');
    end if;

    -- Reserva vencida/cancelada: só emite se ainda houver estoque.
    if o.status <> 'pending' or o.expires_at <= now() then
      select * into e from public.events where id = o.event_id for update;
      for it in select * from public.order_items where order_id = o.id loop
        select * into s from public.batch_stock(o.event_id) b where b.batch_id = it.batch_id;
        if s.available < it.quantity then
          update public.orders set status = 'cancelled', provider = v_provider, provider_payment_id = v_id,
                 provider_method = coalesce(v_method, provider_method),
                 mp_payment_id = case when v_provider = 'mercadopago' then v_id else mp_payment_id end
           where id = o.id;
          perform public.audit('order.paid_without_stock', 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider), 'warning');
          return json_build_object('result', 'needs_refund');
        end if;
      end loop;
      if e.capacity is not null then
        select sum(quantity) into qty_total from public.order_items where order_id = o.id;
        select * into t from public.event_ticket_totals(o.event_id);
        if t.sold + t.reserved + qty_total > e.capacity then
          update public.orders set status = 'cancelled', provider = v_provider, provider_payment_id = v_id,
                 provider_method = coalesce(v_method, provider_method),
                 mp_payment_id = case when v_provider = 'mercadopago' then v_id else mp_payment_id end
           where id = o.id;
          perform public.audit('order.paid_without_stock', 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider), 'warning');
          return json_build_object('result', 'needs_refund');
        end if;
      end if;
    end if;

    update public.orders
       set status = 'paid', paid_at = now(), provider = v_provider, provider_payment_id = v_id,
           provider_method = coalesce(v_method, provider_method),
           mp_payment_id = case when v_provider = 'mercadopago' then v_id else mp_payment_id end,
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
    perform public.audit('order.paid', 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider, 'tickets', n, 'total', o.total));
    return json_build_object('result', 'issued', 'tickets', n);

  elsif v_status in ('pending', 'in_process', 'authorized') then
    if o.status = 'pending' then
      -- Segura a reserva até o vencimento da cobrança (cartão: 30 min; Pix: o próprio prazo da reserva).
      v_hold := least(coalesce(nullif(p_payment->>'date_of_expiration', '')::timestamptz, now() + interval '30 minutes'), now() + interval '4 days');
      update public.orders
         set expires_at = greatest(expires_at, v_hold),
             provider = case when v_register or provider_payment_id is null then v_provider else provider end,
             provider_payment_id = case when v_register or provider_payment_id is null then v_id else provider_payment_id end,
             provider_method = case when v_register or provider_payment_id is null then coalesce(v_method, provider_method) else provider_method end,
             mp_payment_id = case when v_provider = 'mercadopago' then v_id else mp_payment_id end,
             payment_method = case when v_register or provider_payment_id is null then coalesce(p_payment->>'payment_type', payment_method) else payment_method end
       where id = o.id;
    end if;
    return json_build_object('result', 'pending');

  elsif v_status = 'rejected' then
    -- Mantém a reserva até expirar para o comprador tentar outro meio.
    return json_build_object('result', 'rejected');

  elsif v_status in ('cancelled', 'expired') then
    if o.status = 'pending' and v_mine then
      update public.orders set status = case when v_provider = 'purincash' and v_status = 'expired' then 'expired' else 'cancelled' end
       where id = o.id;
    end if;
    return json_build_object('result', 'cancelled');

  elsif v_status in ('refunded', 'charged_back') then
    -- Só a cobrança que pagou o pedido cancela os ingressos (estorno de um pagamento duplicado não).
    if v_mine and o.status in ('paid', 'pending', 'cancelled') then
      update public.orders set status = v_status where id = o.id;
      update public.tickets set status = 'cancelled' where order_id = o.id and status = 'valid';
      perform public.audit('order.' || v_status, 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider), 'warning');
    elsif not v_mine then
      perform public.audit('payment.duplicate_' || v_status, 'order', o.id::text, jsonb_build_object('payment_id', v_id, 'provider', v_provider), 'info');
    end if;
    return json_build_object('result', 'refunded');
  end if;

  return json_build_object('result', 'unknown_status');
end $$;
revoke execute on function public.apply_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Reserva / desistência: um pedido com cobrança criada (de qualquer
-- provedor) não é cancelado automaticamente — ele pode ser pago.
-- (Igual à 0006, trocando mp_payment_id por provider_payment_id.)
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

  select * into e from public.events where id = p_event for update;
  if not found or not public.event_is_public(p_event) then raise exception 'Evento indisponível.'; end if;
  if e.visibility = 'partial' and e.hide_price then raise exception 'As vendas deste evento abrem em breve.'; end if;
  if e.event_date < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Este evento já aconteceu.'; end if;

  update public.orders set status = 'cancelled'
   where user_id = uid and event_id = p_event and status = 'pending' and provider_payment_id is null and mp_payment_id is null;
  select count(*) into open_orders from public.orders
   where user_id = uid and event_id = p_event and status = 'pending' and expires_at > now();
  if open_orders >= 3 then raise exception 'Você já tem pagamentos em andamento para este evento. Conclua-os ou aguarde.'; end if;

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

create or replace function public.cancel_my_order(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.orders set status = 'cancelled'
   where id = p_order and user_id = auth.uid() and status = 'pending' and provider_payment_id is null and mp_payment_id is null;
end $$;
revoke execute on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Relatório do produtor: pedidos expirados com cobrança criada continuam
-- aparecendo (igual à 0006, trocando mp_payment_id por provider_payment_id).
-- ---------------------------------------------------------------------
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
         where o.event_id = p_event and o.status <> 'cancelled'
           and (o.status <> 'expired' or o.provider_payment_id is not null or o.mp_payment_id is not null)) x), '[]'::json),
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

-- ---------------------------------------------------------------------
-- Registro de auditoria pelo servidor (webhook/estornos), sem expor audit() a usuários.
-- ---------------------------------------------------------------------
create or replace function public.server_audit(p_action text, p_target_type text, p_target_id text, p_metadata jsonb default '{}'::jsonb, p_severity text default 'info')
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.audit(p_action, p_target_type, p_target_id, p_metadata, p_severity);
end $$;
revoke execute on function public.server_audit(text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.server_audit(text, text, text, jsonb, text) to service_role;
