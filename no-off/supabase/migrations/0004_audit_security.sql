-- =====================================================================
-- NO OFF — AUDITORIA E ALERTAS DE SEGURANÇA
-- Execute depois de 0001–0003. Idempotente (pode rodar de novo).
--
--  * audit_logs: trilha de ações administrativas, de produtores e eventos de
--    segurança; o super admin lê tudo; ninguém altera registros.
--  * admin_settings: configurações PRIVADAS (e-mail do admin padrão para
--    alertas). platform_settings é de leitura pública e por isso NÃO guarda
--    dados pessoais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null, -- null = sistema / servidor
  action      text not null check (char_length(action) between 3 and 80),
  target_type text check (char_length(target_type) <= 40),
  target_id   text check (char_length(target_id) <= 120),
  severity    text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  metadata    jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192)
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_target_idx on public.audit_logs (target_type, target_id, created_at desc);

-- Registros de auditoria são imutáveis (nem administradores editam).
create or replace function public.audit_logs_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Registros de auditoria não podem ser alterados.';
end $$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Grava um evento de auditoria. Interna: chamada apenas por outras funções/triggers.
create or replace function public.audit(p_action text, p_target_type text, p_target_id text, p_metadata jsonb default '{}'::jsonb, p_severity text default 'info')
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata, severity)
  values (
    (select id from public.profiles where id = auth.uid()),
    left(p_action, 80), left(p_target_type, 40), left(p_target_id, 120),
    coalesce(p_metadata, '{}'::jsonb),
    case when p_severity in ('info', 'warning', 'critical') then p_severity else 'info' end
  );
end $$;
revoke execute on function public.audit(text, text, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Configurações privadas (somente super admin)
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

-- Busca de usuários (inclui e-mail e celular: só super admin).
create or replace function public.admin_find_users(p_query text)
returns table (id uuid, username text, full_name text, email text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
declare q text := lower(trim(coalesce(p_query, '')));
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if char_length(q) < 2 then return; end if;
  return query
    select p.id, p.username, p.full_name, coalesce(u.email, u.phone)::text, p.role
      from public.profiles p join auth.users u on u.id = p.id
     where p.username ilike '%' || q || '%' or lower(coalesce(u.email, '')) like '%' || q || '%'
        or coalesce(u.phone, '') like '%' || q || '%' or lower(p.full_name) like '%' || q || '%'
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
  select * into s from public.admin_settings where id = 1 for update;
  if not found then
    insert into public.admin_settings (id) values (1) on conflict do nothing;
    select * into s from public.admin_settings where id = 1 for update;
  end if;

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

create or replace function public.admin_security_test_logged()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  perform public.audit('security_settings.test_email', 'admin_settings', '1', '{}'::jsonb);
end $$;
revoke execute on function public.admin_security_test_logged() from public, anon;
grant execute on function public.admin_security_test_logged() to authenticated;

-- ---------------------------------------------------------------------
-- Triggers de auditoria
-- ---------------------------------------------------------------------

-- Papel de usuário: audita e impede remover o último super admin.
create or replace function public.audit_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if old.role = 'super_admin' and not exists (select 1 from public.profiles where role = 'super_admin' and id <> old.id) then
      raise exception 'Não é possível remover o último super admin.';
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
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.audit_logs enable row level security;
alter table public.admin_settings enable row level security;
alter table public.auth_failures enable row level security;

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs for select to authenticated using (public.is_admin());

drop policy if exists "admin settings read" on public.admin_settings;
create policy "admin settings read" on public.admin_settings for select to authenticated using (public.is_admin());
drop policy if exists "admin settings update" on public.admin_settings;
create policy "admin settings update" on public.admin_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- auth_failures: sem políticas = inacessível pela API (somente funções security definer e service_role).
revoke all on public.audit_logs, public.auth_failures from anon;
revoke insert, update, delete on public.audit_logs from authenticated;
