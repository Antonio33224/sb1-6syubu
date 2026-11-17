-- =====================================================================
-- Promover o PRIMEIRO administrador do Classify DJ
--
-- 1. Crie a conta normalmente em /entrar?modo=cadastro (e confirme o e-mail).
-- 2. Supabase → SQL Editor → cole este script, troque o e-mail e rode.
-- 3. Saia e entre de novo no site: o link "Admin" leva a /admin.
--
-- Depois disso, novos admins podem ser promovidos pelo painel
-- (/admin → Usuários). Toda troca de papel fica no Audit Log, e o banco
-- impede remover o último administrador.
-- O SQL Editor roda como superusuário (auth.uid() nulo), por isso o
-- trigger protect_profile_fields permite a alteração.
-- =====================================================================

update public.profiles
   set role = 'admin'
 where id = (select id from auth.users where lower(email) = lower('SEU-EMAIL@exemplo.com'));

-- Conferência: deve listar a sua conta com role = admin.
select p.username, u.email, p.role
  from public.profiles p join auth.users u on u.id = p.id
 where p.role = 'admin';

-- Opcional: já defina o e-mail que recebe os alertas de segurança
-- (também editável em /admin → Segurança).
-- update public.admin_settings set admin_alert_email = 'SEU-EMAIL@exemplo.com' where id = 1;
