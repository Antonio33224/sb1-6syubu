-- =====================================================================
-- NO OFF — GATEWAY MISTICPAY (somente Pix). Execute depois de 0001–0007.
-- Idempotente. NÃO apaga dados antigos: pedidos/pagamentos do Mercado Pago
-- e do PurinCash continuam válidos.
--
--   orders.provider aceita 'misticpay'
--   payments.provider passa a ter 'misticpay' como padrão
--   misticpay_webhook_events
--       deduplicação das notificações (transação + estado + reembolso)
--       — a MisticPay não envia id de entrega nem assinatura
--   apply_payment()
--       aceita provider = 'misticpay' (status já normalizados pelo servidor:
--       pending | paid | failed | cancelled | expired | refunded) e confere o
--       valor em centavos com o total do pedido (diferente → amount_mismatch)
-- =====================================================================

alter table public.orders drop constraint if exists orders_provider_check;
alter table public.orders add constraint orders_provider_check check (provider is null or provider in ('mercadopago', 'purincash', 'misticpay'));
alter table public.payments alter column provider set default 'misticpay';

-- ---------------------------------------------------------------------
-- Webhooks da MisticPay: a mesma notificação é processada uma única vez
-- ---------------------------------------------------------------------
create table if not exists public.misticpay_webhook_events (
  id             bigint generated always as identity primary key,
  dedup_key      text not null unique check (char_length(dedup_key) <= 200),
  transaction_id text check (char_length(transaction_id) <= 80),
  status         text check (char_length(status) <= 40),
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  result         text check (char_length(result) <= 60)
);
create index if not exists misticpay_webhook_events_received_idx on public.misticpay_webhook_events (received_at desc);
alter table public.misticpay_webhook_events enable row level security;
-- Sem políticas: somente service_role.
revoke all on public.misticpay_webhook_events from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- APLICAÇÃO DO PAGAMENTO (somente service_role). Idêntica à 0007, passando
-- a aceitar 'misticpay' com o mesmo mapeamento de status do PurinCash.
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
  if v_provider not in ('mercadopago', 'purincash', 'misticpay') then raise exception 'Provedor de pagamento inválido.'; end if;
  if v_method is not null and v_method not in ('pix', 'card') then v_method := null; end if;
  v_status := case
    when v_provider in ('purincash', 'misticpay') then case v_raw when 'paid' then 'approved' when 'failed' then 'rejected' else v_raw end
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
      update public.orders set status = case when v_provider in ('purincash', 'misticpay') and v_status = 'expired' then 'expired' else 'cancelled' end
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
