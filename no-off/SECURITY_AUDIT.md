# Auditoria de segurança — NO OFF

**Data:** 23/11/2026.

**Escopo:**
- Código do repositório: Next.js 15, rotas `/api/*` e serviços do navegador.
- Migrações Supabase `0001`–`0006`.

**Método:**
- Revisão manual de RLS, funções `security definer`, rotas de API, checkout, webhook do Mercado Pago, visibilidade de festas e painéis.
- Testes automatizados (`npm test`).
- Execução das migrações num Postgres em WASM (PGlite) com stubs de `auth`/`storage`. Foram 78 verificações do fluxo produtor → lotes → visibilidade → reserva → pagamento → check-in → suspensão → auditoria.

**Limites:**
- Não houve teste de intrusão em ambiente publicado.
- Não foram revisadas as configurações dos painéis do Supabase, da Vercel e do Mercado Pago.
- O PGlite não reproduz 100% do Supabase (Realtime, Storage e Auth reais). Rode as migrações num projeto de teste antes da produção.

Legenda: ✅ implementado · 🟡 mitigado (risco residual) · 📋 recomendação

---

## Resumo

| # | Tema | Status |
|---|---|---|
| 1 | Campos ocultos de festas nunca enviados ao navegador | ✅ |
| 2 | Festa "Oculta" responde 404 e não aparece em listagens, busca, rankings e sitemap | ✅ |
| 3 | Valor cobrado vem do banco; navegador não define preço | ✅ |
| 4 | Webhook do Mercado Pago: assinatura, idempotência e consulta à API | ✅ |
| 5 | Ingresso só é emitido com pagamento aprovado (função restrita à service_role) | ✅ |
| 6 | Estoque: reserva com trava, sem venda além do lote ou da capacidade | ✅ |
| 7 | Produtor isolado: só vê e edita as próprias festas | ✅ |
| 8 | Check-in sem reuso, inclusive com leituras simultâneas | ✅ |
| 9 | Super admin separado do produtor; suspensão de produtores e festas | ✅ |
| 10 | Audit log imutável das alterações | ✅ |
| 11 | Dados pessoais (CPF, e-mail, celular) — exposição mínima | ✅ |
| 12 | Credenciais apenas em variáveis de ambiente | ✅ |
| 13 | Força bruta no login | 🟡 |
| 14 | CSP completa | 📋 |
| 15 | CAPTCHA / rate limit no Supabase Auth e no OTP por SMS | 📋 |

---

## Detalhes

### 1–2. Visibilidade filtrada no servidor ✅
- `anon` **não** tem `SELECT` em `public.events`.
- O usuário logado só lê, pela RLS, as festas de que é dono (ou todas, se for super admin).
- O público lê a view `public.public_events` (`security_barrier`), que:
  - exclui festas ocultas, rascunhos, suspensas e de produtores suspensos;
  - devolve `NULL` em nome, preço, local, capacidade e vendidos quando o toggle está ativo;
  - troca a slug pelo id quando o nome está oculto.
- Os filtros do cliente (`?name=eq.X`) operam sobre o valor já mascarado e não conseguem sondar o valor real (verificado).
- Os lotes públicos vêm de `public_event_batches()`, que mascara preço e estoque e bloqueia vendas quando o preço está oculto.
- `/eventos/[slug]` é server component: festa inexistente na view → `notFound()` (HTTP 404).
- O sitemap usa a mesma view.

### 3. Preço ✅
- `reserve_order()` grava `unit_price` a partir do lote no banco.
- `/api/checkout/pay` envia ao MP `transaction_amount = orders.total` e ignora o valor do formulário. Há teste cobrindo isso.
- `apply_payment()` recusa emitir se o valor aprovado divergir do pedido e registra `payment.amount_mismatch` como `critical`.

### 4. Webhook ✅
- Valida `x-signature`: HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com `MP_WEBHOOK_SECRET`, comparado com `timingSafeEqual`.
- Sem segredo configurado, a rota responde 503 e nada é processado.
- **Não confia no corpo**: busca `GET /v1/payments/{id}` com o Access Token.
- Idempotência em `webhook_events` (chave `x-request-id`). Falha de processamento → 500 sem `processed_at`, o que permite o reenvio pelo MP.
- `apply_payment()` também é idempotente: aprovado repetido devolve `already_paid` e não emite em dobro.

### 5. Emissão ✅
`apply_payment()` só pode ser executada pela `service_role`: `authenticated` e `anon` recebem `permission denied` (verificado). Ingressos não têm política de insert/update para usuários.

### 6. Estoque ✅
- `reserve_order()` trava a festa (`SELECT … FOR UPDATE`): reservas da mesma festa são serializadas.
- Antes de gravar, confere o estado do lote, o disponível (vendidos + reservas válidas), o máximo por pedido e a capacidade.
- Reservas vencidas deixam de contar imediatamente; o cron só faz limpeza.
- Pix e boleto estendem a reserva até o vencimento.
- Pagamento aprovado depois da expiração sem estoque → `needs_refund` → estorno automático.
- Pagamento duplicado no mesmo pedido → estorno do excedente.

### 7. Isolamento do produtor ✅
- RLS:
  - `events`: dono ou super admin.
  - `ticket_batches`, `vip_list`, `vip_signup_links`, `checkins`: via `owns_event()`.
  - `orders`, `tickets`, `payments`: comprador dono ou `owns_event()`.
- O trigger `protect_event_fields` força `producer_id = auth.uid()` e impede o produtor de alterar visibilidade, toggles, `is_demo` e de suspender ou reativar a festa.
- Produtor suspenso perde `is_producer()` / `owns_event()`.

### 8. Check-in ✅
- `checkin_ticket()` usa `FOR UPDATE` no ingresso e, se já estiver usado, devolve `already_used` com o horário.
- `checkins.ticket_id` é `unique`.
- QR Code = 80 bits aleatórios (`gen_random_bytes(10)`), impossível de adivinhar.

### 9. Super admin ✅
- `is_admin()` ⇔ `role = 'super_admin'`.
- As rotas `/api/admin/*` conferem o papel no servidor antes de qualquer acesso: 401 sem login, 403 para comprador ou produtor, com testes cobrindo as 11 rotas.
- As funções `admin_*` conferem de novo.
- O último super admin não pode ser rebaixado.

### 10. Auditoria ✅
`audit_logs` registra:
- criação e edição de festa (lista de campos alterados);
- lotes (insert, update, delete);
- visibilidade e status;
- suspensão e reativação de usuários;
- pedidos pagos e estornos;
- divergência de valor;
- geração de relatório;
- papel de usuário, configurações, moderação e alertas de login.

O log é imutável (trigger) e só o super admin lê. O painel mostra os logs por festa e por produtor.

### 11. Dados pessoais ✅
- CPF, e-mail e celular do comprador ficam em `orders`, legíveis só pelo comprador, pelo produtor da festa e pelo super admin.
- O relatório é gerado **no servidor** (`producer_event_report()` confere o dono) e cada geração é auditada.
- Na busca da portaria o CPF aparece mascarado.
- Os logs do servidor mascaram e-mail, CPF, telefone, cartão, JWT e tokens do MP (`APP_USR-`/`TEST-`).
- O CSV neutraliza fórmulas (`=`, `+`, `-`, `@`).

### 12. Credenciais ✅
`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` e `SMTP_PASS` são lidos só no servidor, sem prefixo `NEXT_PUBLIC_`. O navegador recebe apenas a Public Key do MP e a anon key do Supabase. Em produção, um Access Token de teste é recusado.

### 13. Força bruta no login 🟡
- Falhas de senha são registradas via `/api/auth/login-failed` (IP em HMAC) e geram alerta por e-mail ao admin padrão.
- Chamadas diretas à API do Supabase não passam pelo site, então o rate limit do Supabase Auth continua sendo a barreira real.

### 14. CSP 📋
A CSP atual é mínima: `frame-ancestors`, `base-uri`, `object-src` e `form-action`. A CSP completa precisa liberar:
- Supabase (REST e Realtime em `wss`);
- `sdk.mercadopago.com`, `*.mercadopago.com` e `*.mercadolibre.com` (scripts e iframes do Brick);
- tiles do mapa;
- imagens do Storage.

Teste em staging antes de ativar.

### 15. Supabase Auth 📋
- Ativar CAPTCHA (hCaptcha/Turnstile) em login, cadastro e OTP.
- Revisar os rate limits de SMS (custo e abuso).
- Exigir confirmação de e-mail.
- Ativar *leaked password protection*.

---

## Como validar

```bash
npm run lint && npm run typecheck && npm test
```

Num projeto Supabase de teste: aplique `0001`–`0006`, rode o seed e faça uma compra no sandbox com cartão `APRO`, Pix e boleto. Depois confira:
- o webhook em `webhook_events`;
- o ingresso em **Meus ingressos**;
- o check-in duplo bloqueado;
- uma festa "Oculta" respondendo 404.
