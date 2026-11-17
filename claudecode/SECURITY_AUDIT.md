# Auditoria de segurança — Classify DJ

**Data:** 17/11/2026 · **Escopo:** código do repositório (Next.js 15, rotas `/api/*`, serviços do navegador) e migrações Supabase `0001`–`0006`.
**Método:** revisão manual de código, RLS, funções `security definer`, rotas de API, fluxo de autenticação, cobrança e concierge de voz, com testes automatizados para as correções.
**Fora do escopo / limites:** não houve teste de intrusão contra um ambiente publicado, nem revisão das configurações do painel do Supabase, da Vercel ou do Stripe. As migrações foram revisadas, mas **não executadas** neste ambiente (não havia banco disponível). Rode `supabase/tests/coupons.sql` num projeto de teste para validá-las.

Legenda de status: ✅ corrigido · 🟡 mitigado (risco residual documentado) · 📋 recomendação (não alterado)

---

## Resumo

| # | Achado | Gravidade | Status |
|---|---|---|---|
| 1 | Concierge de voz (custo OpenAI) acessível a qualquer usuário logado | Alta | ✅ |
| 2 | Nenhuma trilha de auditoria para ações administrativas | Média | ✅ |
| 3 | Admin podia remover o próprio papel / o último admin | Média | ✅ |
| 4 | Sem detecção nem alerta de força bruta no login | Média | 🟡 |
| 5 | Logs do servidor podiam conter e-mails, tokens e mensagens de erro completas | Média | ✅ |
| 6 | `platform_settings` é de leitura pública: lugar inadequado para dados privados | Média (preventivo) | ✅ |
| 7 | Cabeçalhos de segurança HTTP ausentes (clickjacking, sniffing, microfone) | Baixa/Média | ✅ (CSP completa 📋) |
| 8 | Painel `/admin` protegido só no cliente | Informativo | ✅ verificado + reforçado |
| 9 | Cupons: risco de uso duplo, estouro de limite e força bruta de códigos | Alta (nova funcionalidade) | ✅ (por desenho) |
| 10 | Credenciais de demonstração exibidas em `/entrar` | Informativo | 📋 |
| 11 | Ausência de lint/regras estáticas no projeto | Baixa | ✅ |
| 12 | Login direto no Supabase sem CAPTCHA | Média | 📋 |

---

## Achados e correções

### 1. IA de voz sem paywall — Alta ✅
**Antes:** `POST /api/voice/session` só exigia login. Qualquer conta gratuita gerava tokens da OpenAI Realtime (custo direto), limitada apenas pelo rate limit.
**Correção (duas camadas):**
- `src/lib/server/voice/handlers.ts`: o `guard` chama `public.has_premium()` e responde **403 `subscription_required`** em `session` (POST/DELETE), `tool` e `transcripts` (GET/POST/DELETE). Se a verificação falhar, responde **503** (nunca libera por erro).
- `0006`: `voice_start_session` e `voice_register_tool_call` também recusam quem não tem Classify+. Isso vale mesmo se o handler for burlado ou houver corrida no fim do período.
- O cliente esconde o microfone e mostra o CTA do Classify+ / cupom; a sessão é encerrada se o acesso acabar.
**Testes:** `tests/voice-paywall.test.ts`.

### 2. Sem audit log — Média ✅
**Correção:** tabela `public.audit_log`:
- **imutável**: um trigger bloqueia UPDATE e não há política de insert/update/delete;
- leitura **só por admin** (RLS);
- escrita apenas pela função interna `public.audit()`, sem permissão de execução para `anon`/`authenticated`.

O que é registrado:
- cupons (criar, editar, ativar e desativar);
- resgates de cupom;
- gratuidades concedidas e revogadas;
- **troca de papel** de usuário;
- alterações de `platform_settings` e das configurações de segurança;
- exclusão de casas e eventos;
- moderação de avaliações;
- alertas de login falho.

Os registros aparecem em `/admin → Auditoria`.

### 3. Remoção do último admin — Média ✅
**Antes:** `profiles.role` podia ser trocado por qualquer admin, inclusive o próprio, sem registro. O sistema podia ficar sem administrador.
**Correção:** o trigger `audit_profile_role` (AFTER UPDATE) impede rebaixar o último admin e registra toda troca de papel como `critical`.

### 4. Força bruta no login — Média 🟡
**Contexto:** o login é feito direto no Supabase Auth pelo navegador. O servidor do site não vê senhas.
**Correção:**
- Quando o Supabase recusa as credenciais, o cliente avisa `POST /api/auth/login-failed`.
- O servidor grava a falha em `auth_failures` via `public.record_login_failure()`. Essa função só pode ser executada com service_role. O IP é guardado apenas como **HMAC-SHA256**.
- Ao atingir o limite (padrão: 5 falhas por conta ou 15 por IP em 15 min), o servidor envia **e-mail para o "E-mail do admin padrão"** definido em `/admin → Segurança`, por SMTP (nodemailer).
- Há um intervalo mínimo entre alertas (padrão: 60 min) controlado no banco, com trava de linha, o que vale para todas as instâncias serverless.
- O alerta também vai para o audit log, mesmo sem SMTP.
- O usuário vê "Muitas tentativas…" depois de N falhas a partir do mesmo IP.
- Proteções do próprio endpoint: resposta sempre genérica (`202`), entrada validada, teto de 200 registros por IP por janela e limpeza automática após 30 dias.

**Risco residual:** um atacante que chame a API do Supabase Auth **diretamente** não passa pelo site, e essas falhas não são registradas. Pelo mesmo motivo, o bloqueio exibido na tela é só informativo. A barreira real é o rate limit do Supabase Auth. → ver item 12.
**Testes:** `tests/login-alerts.test.ts`.

### 5. Dados pessoais nos logs — Média ✅
**Antes:** `console.error('[billing]', err)` e `console.error('[webhook]', event.type, err)` registravam objetos de erro inteiros, que podem conter e-mail do cliente e detalhes da requisição. Os handlers de voz registravam mensagens cruas.
**Correção:** `src/lib/server/log-sanitize.ts` (`log.error/warn/info`) mascara:
- e-mails (`jo***@g***.com`);
- tokens Bearer e JWT;
- chaves `sk-`/`sk_`/`whsec_`/`ek_`;
- CPF, telefones e números de cartão.

Erros viram só `Nome: mensagem`. UUIDs são preservados para depuração. Já foi aplicado às rotas de voz, cobrança, webhook, cupons, admin e alertas.
**Testes:** `tests/login-alerts.test.ts` (seção de logs).

### 6. Dados privados em tabela pública — preventivo ✅
`platform_settings` tem a política `settings read … using (true)` e é legível por qualquer visitante. O e-mail de alertas **não** foi colocado lá: foi criada a tabela `admin_settings`, que só admins leem e alteram. O trigger dessa tabela registra no audit log apenas *que* o e-mail mudou, sem gravar o endereço.

### 7. Cabeçalhos HTTP — Baixa/Média ✅ (CSP completa 📋)
Adicionados em `next.config.mjs`:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- HSTS
- `Permissions-Policy: microphone=(self)`, com câmera e payment desligados
- CSP mínima: `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`
- `Cache-Control: no-store` em `/api/*`

📋 **Próximo passo:** CSP completa com `script-src`/`connect-src`. Exige listar Supabase, `api.openai.com` (WebRTC), tiles do Leaflet e domínios de imagem, e testar em staging antes de ativar, porque pode quebrar o mapa e a voz.

### 8. `/admin` protegido no cliente — verificado ✅
A página esconde a interface quando `role !== 'admin'`, mas a proteção real é do banco. Verifiquei que **toda** escrita administrativa já existente passa por RLS com `is_admin()` ou por RPCs que conferem `is_admin()`: venues, events, reviews, reports, newsletter, settings, benefícios e métricas.

As **novas** rotas `/api/admin/*` conferem o papel **no servidor** (`public.is_admin()`) antes de qualquer acesso: **401** sem login e **403** para usuário comum. Se a verificação falhar, a resposta é 403. Depois disso, as funções `admin_*` conferem de novo.
**Testes:** `tests/admin-routes.test.ts` cobre as 11 combinações de rota e método.

### 9. Cupons — por desenho ✅
- **Atomicidade:** `public.redeem_coupon()` faz tudo numa transação:
  - `pg_advisory_xact_lock` por usuário, contra dois cliques ou duas abas;
  - `SELECT … FOR UPDATE` na linha do cupom, contra corrida entre usuários.

  O contador nunca passa de `max_redemptions` e o limite por usuário nunca é furado. A rota **não** faz "verifica e depois grava".
- **Força bruta de códigos:** 10 tentativas inválidas por usuário por hora → `too_many_attempts`. Cupom inativo e inexistente dão a mesma resposta, o que não revela códigos.
- **Formato:** código restrito a `^[A-Z0-9-]{4,32}$` no banco, na API e na interface.
- **RLS:** `coupons` só admin lê; `premium_grants` e `coupon_redemptions` o próprio usuário e admin leem. Escrita só via funções.

**Testes:** `tests/coupons.test.ts` (expirado, esgotado, limite por usuário, uso duplo simultâneo, corrida entre usuários, força bruta) e `supabase/tests/coupons.sql` (no Postgres real).

### 10. Credenciais de demonstração em `/entrar` — Informativo 📋
São exibidas **somente** em modo demonstração (`data.mode === 'demo'`, sem Supabase) e valem apenas para o banco local do navegador. Não há risco em produção com Supabase. Recomendo manter assim e nunca criar essas contas no Supabase real.

### 11. Lint ausente — Baixa ✅
Adicionados ESLint 9 (`eslint-config-next` core-web-vitals + typescript), regras `no-eval`, `no-implied-eval` e `no-new-func`, e o script `npm run lint` (`--max-warnings=0`). Os 6 avisos já existentes foram corrigidos.

### 12. CAPTCHA e rate limit do Supabase Auth — Média 📋
**Recomendado (configuração no painel do Supabase, sem código):**
- Authentication → Attack Protection → ativar **CAPTCHA** (hCaptcha ou Turnstile) no login, cadastro e recuperação de senha;
- revisar os **Rate Limits** de sign-in;
- exigir confirmação de e-mail;
- considerar senha mínima mais forte e *leaked password protection*.

Isso fecha o risco residual do item 4.

---

## O que já estava correto (verificado)

- **Webhook Stripe:** HMAC-SHA256 do corpo bruto com `timingSafeEqual`, janela anti-replay de 5 min e idempotência por `billing_webhook_events`. O status da assinatura vem da API do Stripe, nunca do navegador.
- **Checkout:** o acesso só é liberado pelo webhook; o teste grátis é validado no servidor; `allow_promotion_codes=false`.
- **Chaves:** `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são usadas só no servidor, sem prefixo `NEXT_PUBLIC_`. O navegador recebe apenas um token efêmero da OpenAI (60 s), e o corpo de erro da OpenAI não é repassado.
- **Tools de voz:** somente leitura, argumentos validados por zod, ids validados por regex antes de chegar ao banco e `user_id` sempre vindo da sessão.
- **`mostrar_opcoes`:** só exibe registros que existem no banco; ids malformados ou inexistentes são descartados e informados ao modelo.
- **Histórico de voz:** URLs dos cartões restritas a rotas internas por regex (sem `javascript:`).
- **`profiles`:** usuário comum não altera `role`/`is_demo` (trigger `protect_profile_fields`); o perfil público não expõe e-mail.
- **Funções `security definer`:** todas com `set search_path = public` (ou `public, auth`). As internas (`_has_premium`, `audit`, `record_login_failure`) não podem ser executadas por `authenticated`/`anon`.
- **Redirecionamento pós-login:** `safeNext` bloqueia `//host` e URLs externas.

## Como validar

```bash
npm run lint && npm run typecheck && npm test
```
No Supabase de teste: aplique `0006` e rode `supabase/tests/coupons.sql`. A saída esperada é `NOTICE: OK: todos os cenários de cupom passaram.`
