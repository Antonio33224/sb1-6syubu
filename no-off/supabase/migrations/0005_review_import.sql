-- =====================================================================
-- NO OFF — Importação de avaliações do PRÉ-LANÇAMENTO (planilha)
--
--  * venue_reviews.source: 'app' (padrão) | 'pre_launch' (importada pelo admin)
--  * profiles.is_imported: perfil criado pela importação (conta sem senha,
--    não faz login). Exibido com a tag "Coletada no pré-lançamento".
--  * admin_import_reviews(jsonb): só admin; tudo ou nada; audit log.
--  * As avaliações importadas contam normalmente em médias, rankings e selo.
-- =====================================================================

alter table public.venue_reviews
  add column if not exists source text not null default 'app' check (source in ('app', 'pre_launch'));
alter table public.profiles
  add column if not exists is_imported boolean not null default false;

-- Usuário comum não altera papel, demo nem a marcação de importado.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.is_demo := old.is_demo;
    new.is_imported := old.is_imported;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- Regras das avaliações: igual à 0001, com duas mudanças:
--  1) a importação do admin (flag de transação + is_admin) é tratada como contexto de serviço;
--  2) `source` nunca é definido pelo cliente (sempre 'app' no app; preservado em edições).
create or replace function public.enforce_review_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  if uid is null or pg_trigger_depth() > 1
     or (coalesce(current_setting('nooff.review_import', true), '') = 'on' and public.is_admin()) then
    new.overall_rating := public.compute_overall_rating(new.music_rating, new.crowd_rating, new.atmosphere_rating,
      new.drinks_rating, new.service_rating, new.organization_rating, new.experience_rating);
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> uid then raise exception 'Não é possível avaliar em nome de outra pessoa.'; end if;
    new.status := 'published';
    new.is_demo := false;
    new.source := 'app';
    new.created_at := now();
  else
    if old.user_id <> uid then
      if not public.is_admin() then raise exception 'Sem permissão.'; end if;
      if (new.music_rating, new.crowd_rating, new.atmosphere_rating, new.drinks_rating, new.service_rating,
          new.organization_rating, new.experience_rating, new.comment, new.photos, new.experience_date, new.user_id, new.venue_id, new.source)
         is distinct from
         (old.music_rating, old.crowd_rating, old.atmosphere_rating, old.drinks_rating, old.service_rating,
          old.organization_rating, old.experience_rating, old.comment, old.photos, old.experience_date, old.user_id, old.venue_id, old.source) then
        raise exception 'A moderação não altera o conteúdo de avaliações legítimas.';
      end if;
      return new;
    end if;
    new.user_id := old.user_id;
    new.venue_id := old.venue_id;
    new.status := old.status;
    new.is_demo := old.is_demo;
    new.source := old.source;
    new.created_at := old.created_at;
    insert into public.venue_review_revisions (review_id, music_rating, crowd_rating, atmosphere_rating, drinks_rating,
      service_rating, organization_rating, experience_rating, overall_rating, comment, experience_date, created_at)
    values (old.id, old.music_rating, old.crowd_rating, old.atmosphere_rating, old.drinks_rating, old.service_rating,
      old.organization_rating, old.experience_rating, old.overall_rating, old.comment, old.experience_date, old.updated_at);
  end if;

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

-- ---------------------------------------------------------------------
-- Importação (tudo ou nada: qualquer erro desfaz a transação inteira)
-- p_rows: [{ line, venue_id, author_username, author_name, music_rating, crowd_rating,
--            atmosphere_rating, drinks_rating, service_rating, organization_rating,
--            experience_rating, comment, experience_date }]
-- ---------------------------------------------------------------------
create or replace function public.admin_import_reviews(p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r jsonb;
  ln text;
  v_username text;
  v_name text;
  v_comment text;
  v_date date;
  v_venue uuid;
  v_user uuid;
  v_imported boolean;
  v_ts timestamptz;
  k text;
  n_created int := 0;
  n_profiles int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma avaliação para importar.';
  end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Máximo de 500 avaliações por importação.'; end if;

  perform set_config('nooff.review_import', 'on', true);

  for r in select * from jsonb_array_elements(p_rows) loop
    ln := 'Linha ' || coalesce(r->>'line', '?') || ': ';
    v_username := lower(trim(coalesce(r->>'author_username', '')));
    v_name := left(trim(coalesce(r->>'author_name', '')), 80);
    v_comment := trim(coalesce(r->>'comment', ''));

    if v_username !~ '^[a-z0-9._]{3,24}$' then raise exception '%usuário "%" inválido.', ln, v_username; end if;
    begin
      v_venue := (r->>'venue_id')::uuid;
    exception when others then
      raise exception '%estabelecimento inválido.', ln;
    end;
    if not exists (select 1 from public.venues where id = v_venue) then raise exception '%estabelecimento não encontrado.', ln; end if;

    foreach k in array array['music_rating','crowd_rating','atmosphere_rating','drinks_rating','service_rating','organization_rating','experience_rating'] loop
      if jsonb_typeof(r->k) <> 'number' or (r->>k)::numeric not between 0 and 10 then
        raise exception '%nota "%" deve estar entre 0 e 10.', ln, k;
      end if;
    end loop;

    if v_comment ~* '(https?://|www\.)' then raise exception '%links não são permitidos nos comentários.', ln; end if;
    if char_length(v_comment) between 1 and 9 then raise exception '%o comentário precisa de pelo menos 10 caracteres.', ln; end if;
    if char_length(v_comment) > 2000 then raise exception '%comentário com mais de 2000 caracteres.', ln; end if;

    v_date := nullif(r->>'experience_date', '')::date;
    if v_date > current_date + 1 then raise exception '%a data da experiência não pode estar no futuro.', ln; end if;

    -- Autor: reaproveita perfil importado; nunca usa a conta de um usuário real.
    select id, is_imported into v_user, v_imported from public.profiles where username = v_username;
    if found and not v_imported then
      raise exception '%@% já pertence a uma conta real.', ln, v_username;
    end if;
    if not found then
      v_user := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
        v_username || '@imported.nooff.invalid', '', null,
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'imported', true),
        jsonb_build_object('username', v_username, 'full_name', v_name),
        now(), now(), '', '', '', '');
      -- handle_new_user já criou o perfil; garante usuário exato e marcação.
      update public.profiles set username = v_username, full_name = v_name, is_imported = true where id = v_user;
      n_profiles := n_profiles + 1;
    end if;

    if exists (select 1 from public.venue_reviews where user_id = v_user and venue_id = v_venue) then
      raise exception '%@% já avaliou este local.', ln, v_username;
    end if;

    v_ts := case when v_date is not null then (v_date + time '23:00') at time zone 'America/Sao_Paulo' else now() end;
    insert into public.venue_reviews (user_id, venue_id, music_rating, crowd_rating, atmosphere_rating, drinks_rating,
      service_rating, organization_rating, experience_rating, comment, experience_date, photos, status, is_demo, source,
      created_at, updated_at)
    values (v_user, v_venue, (r->>'music_rating')::numeric, (r->>'crowd_rating')::numeric, (r->>'atmosphere_rating')::numeric,
      (r->>'drinks_rating')::numeric, (r->>'service_rating')::numeric, (r->>'organization_rating')::numeric,
      (r->>'experience_rating')::numeric, v_comment, v_date, '{}', 'published', false, 'pre_launch', v_ts, v_ts);
    n_created := n_created + 1;
  end loop;

  perform set_config('nooff.review_import', 'off', true);
  perform public.audit('reviews.imported', 'venue_reviews', null,
    jsonb_build_object('created', n_created, 'profiles_created', n_profiles, 'source', 'pre_launch'), 'warning');
  return jsonb_build_object('created', n_created, 'profiles_created', n_profiles);
end $$;
revoke execute on function public.admin_import_reviews(jsonb) from public, anon;
grant execute on function public.admin_import_reviews(jsonb) to authenticated;
