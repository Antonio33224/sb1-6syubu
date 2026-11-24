-- =====================================================================
-- Promover o PRIMEIRO super admin da NO OFF
--
-- 1. Crie a conta normalmente em /entrar (e-mail, Google ou celular).
-- 2. Supabase → SQL Editor → cole este script, troque o e-mail e rode.
-- 3. Saia e entre de novo no site: o menu do avatar mostra "Painel admin" (/admin).
--
-- Depois disso, novos super admins e PRODUTORES (admin_festa) são definidos
-- pelo painel (/admin → Usuários). Toda troca de papel fica no Audit Log, e
-- o banco impede remover o último super admin.
-- O SQL Editor roda como superusuário (auth.uid() nulo), por isso o trigger
-- protect_profile_fields permite a alteração.
-- =====================================================================

update public.profiles
   set role = 'super_admin'
 where id = (select id from auth.users where lower(email) = lower('SEU-EMAIL@exemplo.com'));
-- Conta criada só com celular? Troque a linha acima por:  where id = (select id from auth.users where phone = '5521999999999')

-- Conferência: deve listar a sua conta com role = super_admin.
select p.username, coalesce(u.email, u.phone) as contato, p.role
  from public.profiles p join auth.users u on u.id = p.id
 where p.role = 'super_admin';

-- Opcional: já defina o e-mail que recebe os alertas de segurança
-- (também editável em /admin → Segurança).
-- update public.admin_settings set admin_alert_email = 'SEU-EMAIL@exemplo.com' where id = 1;
