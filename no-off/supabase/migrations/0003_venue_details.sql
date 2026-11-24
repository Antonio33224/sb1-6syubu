-- =====================================================================
-- NO OFF — detalhes opcionais das casas (público, capacidade, horários)
-- e o card de curadoria "Indicado". Execute depois de 0001 e 0002.
-- Todos os campos são opcionais: NULL/vazio = não informado.
-- =====================================================================

alter table public.venues add column if not exists audience_tags text[] not null default '{}';
alter table public.venues add column if not exists capacity int check (capacity is null or capacity > 0);
alter table public.venues add column if not exists opens_at text check (opens_at is null or opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.venues add column if not exists closes_at text check (closes_at is null or closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.venues add column if not exists is_indicated boolean not null default false;

-- Utilitário genérico para colunas updated_at.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
