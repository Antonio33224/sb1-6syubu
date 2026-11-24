-- =====================================================================
-- NO OFF — 0002: média e faixas de preço por estabelecimento
--
-- Todos os campos são opcionais: NULL significa "não informado" e a
-- interface exibe esse estado em vez de inventar um valor.
-- Escrita restrita a administradores pela policy "venues admin write"
-- (definida em 0001). As "Atrações da semana" reutilizam public.events.
-- =====================================================================

alter table public.venues
  add column if not exists avg_price       numeric(10,2),
  add column if not exists entry_price_min numeric(10,2),
  add column if not exists entry_price_max numeric(10,2),
  add column if not exists drink_price_min numeric(10,2),
  add column if not exists drink_price_max numeric(10,2),
  add column if not exists spend_min       numeric(10,2),
  add column if not exists spend_max       numeric(10,2);

alter table public.venues drop constraint if exists venues_prices_non_negative;
alter table public.venues add constraint venues_prices_non_negative check (
  coalesce(avg_price, 0) >= 0 and coalesce(entry_price_min, 0) >= 0 and coalesce(entry_price_max, 0) >= 0
  and coalesce(drink_price_min, 0) >= 0 and coalesce(drink_price_max, 0) >= 0
  and coalesce(spend_min, 0) >= 0 and coalesce(spend_max, 0) >= 0
);

alter table public.venues drop constraint if exists venues_price_ranges_ordered;
alter table public.venues add constraint venues_price_ranges_ordered check (
  (entry_price_min is null or entry_price_max is null or entry_price_min <= entry_price_max)
  and (drink_price_min is null or drink_price_max is null or drink_price_min <= drink_price_max)
  and (spend_min is null or spend_max is null or spend_min <= spend_max)
);

-- Consulta das atrações da semana por casa (venue_id + data).
create index if not exists events_venue_date_idx on public.events (venue_id, event_date);
