# NO **OFF** — Uma nova forma de adquirir experiências noturnas

Plataforma de venda de ingressos para a vida noturna, com agenda, rankings, avaliações e comunidade.
Next.js 15 · React 19 · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Storage, RLS, Realtime) · PurinCash (Pix + cartão) · Leaflet.

---

## Executar

```bash
npm install
npm run dev          # http://localhost:3000
```

O **Supabase é obrigatório**: sem `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` no `.env.local` o site mostra apenas um aviso de configuração ausente.

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e servidor de produção |
| `npm run typecheck` | Checagem de tipos |
| `npm run lint` | ESLint (`--max-warnings=0`) |
| `npm test` | Testes (node:test): rankings, avaliações, checkout, webhook, CPF, relatórios, rotas admin |
## Papéis

| Papel (`profiles.role`) | O que faz |
| --- | --- |
| `comprador` (padrão) | Compra ingressos, vê **Meus ingressos**, avalia e favorita |
| `admin_festa` (produtor) | Painel `/produtor`: cria e edita **somente as próprias** festas, lotes, lista VIP, check-in, dashboard e relatórios |
| `super_admin` | Painel `/admin`: todas as festas, produtores e vendas, visibilidade, suspensões, logs, moderação e catálogo |

O controle de acesso está **no backend**:
- RLS em todas as tabelas.
- Funções `security definer` que conferem `owns_event()` e `is_admin()`.
- Rotas `/api` que validam o token e o papel no servidor.

A interface só esconde o que o usuário não pode usar.

---

## Setup completo

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, execute **em ordem** os arquivos de `supabase/migrations/`:

   | Arquivo | Conteúdo |
   | --- | --- |
   | `0001_base_schema.sql` | Perfis e papéis, casas, avaliações, eventos, favoritos, newsletter, rankings (média bayesiana), RLS, Storage |
   | `0002_venue_prices.sql` | Faixas de preço das casas |
   | `0003_venue_details.sql` | Público, capacidade, horários e "Indicado" |
   | `0004_audit_security.sql` | `audit_logs` imutável, alertas de login falho |
   | `0005_review_import.sql` | Importação de avaliações do pré-lançamento |
   | `0006_ticketing.sql` | Ingressos: lotes, pedidos, reserva, pagamentos, webhooks, ingressos com QR, lista VIP, check-in, visibilidade, relatórios, suspensão, view pública |
   | `0007_purincash.sql` | Gateway PurinCash: colunas de provedor em pedidos/pagamentos, `purincash_webhook_events` (dedup por `X-Webhook-Id`), `apply_payment` conferindo `amountCents` |

   Todas as migrações são idempotentes (podem ser executadas de novo).
3. Se o banco tiver dados demonstrativos de um seed antigo, remova com `select public.remove_demo_data();` (ou em `/admin → Configurações → Remover dados demo`).
4. Crie sua conta no site e rode `scripts/promote-admin.sql` (troque o e-mail) para virar **super admin**. Depois, promova produtores em `/admin → Usuários` (papel "Produtor").
5. Em **Authentication → URL Configuration**:
   - **Site URL**: `https://seu-dominio.com.br`.
   - **Redirect URLs**: `http://localhost:3000/**` e `https://seu-dominio.com.br/**`.

### 2. Login com Google

1. No [Google Cloud Console](https://console.cloud.google.com/):
   - **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth** (tipo "Aplicativo da Web").
   - Em **URIs de redirecionamento autorizados**, cole a *Callback URL* que o Supabase mostra: `https://<projeto>.supabase.co/auth/v1/callback`.
2. No Supabase: **Authentication → Providers → Google** → ative e cole o *Client ID* e o *Client Secret*.

Nada disso fica no `.env` do site.

### 3. Login por celular (SMS / OTP)

1. No Supabase: **Authentication → Providers → Phone** → ative.
2. Escolha o provedor de SMS (**Twilio**, Twilio Verify, MessageBird, Vonage ou Textlocal) e preencha as credenciais dele (no Twilio: *Account SID*, *Auth Token* e *Message Service SID*).
3. Opcional: ajuste o template da mensagem e o tempo de expiração do código.

Os celulares são enviados em formato E.164 (`+55DDDNÚMERO`). O perfil é criado automaticamente no primeiro login, mesmo sem e-mail.

### 4. PurinCash (pagamentos)

Documentação: [docs.purin.cash](https://docs.purin.cash) (versão para IA: `https://docs.purin.cash/llms-full.txt`).

1. No painel do PurinCash, em **Equipe & API → Developer API**:
   - copie a **chave de API** para `PURINCASH_API_KEY` (`ps_test_...` no sandbox, `ps_live_...` em produção);
   - copie o **segredo de webhook** da conta para `PURINCASH_WEBHOOK_SECRET`.
2. **URL do webhook**: cadastre `https://<seu-site>/api/webhooks/purincash` no painel (mesma tela). Além disso, o site envia essa mesma URL como `callbackUrl` **em cada cobrança** — por isso `NEXT_PUBLIC_SITE_URL` precisa ser o domínio HTTPS final. Eventos tratados: `charge.paid`, `payment.paid`, `card_payment.paid`, `refund.completed`, `refund.failed`, `dispute.*`.
3. **Ambientes** (detectados pelo prefixo da chave):
   - **Sandbox (`ps_test_`)**: só Pix; o botão de cartão fica escondido. O QR de sandbox não é pagável — simule com
     `curl -X POST https://api.purin.cash/v1/sandbox/charges/<paymentId>/simulate-paid -H "Authorization: Bearer ps_test_..."`.
     O sandbox sempre envia o evento `payment.paid` (o site trata igual a `charge.paid`).
   - **Produção (`ps_live_`)**: Pix + cartão (página hospedada do PurinCash, 30 min). Em `VERCEL_ENV=production` o servidor **recusa** chave `ps_test_`.
4. **Reembolsos**: Pix é reembolsado pela API (integral, uma vez por venda, taxa de R$ 0,50). Reembolso de **cartão não é documentado** pelo PurinCash: o site registra `payment.refund_manual_required` (crítico) no audit log e o estorno deve ser feito no painel do PurinCash.

Em `localhost` não há webhook: o site **reconcilia** consultando a API (GET da cobrança) enquanto a página do pedido está aberta, no máximo a cada 20 s por cobrança (limite de 120 req/min da conta). Para testar o webhook localmente, use um túnel (ex.: `ngrok http 3000`) e coloque a URL do túnel em `NEXT_PUBLIC_SITE_URL`.

### 5. E-mail (ingressos)

Preencha `SMTP_*` e `EMAIL_FROM`. Qualquer provedor SMTP serve (Resend, SendGrid, Amazon SES, Gmail Workspace etc.). Sem SMTP, os ingressos continuam disponíveis em **Meus ingressos**.

### 6. Variáveis de ambiente

Copie `.env.example` para `.env.local`. Resumo:

| Variável | Onde | Para quê |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador + servidor | Supabase (protegido por RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor** | Aplicar pagamentos, enviar ingressos, cron, alertas |
| `NEXT_PUBLIC_SITE_URL` | ambos | Links, OAuth, `callbackUrl` do PurinCash, sitemap |
| `PURINCASH_API_KEY` | **só servidor** | API do PurinCash (`ps_test_` sandbox / `ps_live_` produção) |
| `PURINCASH_WEBHOOK_SECRET` | **só servidor** | Validação do `X-Webhook-Signature` |
| `PURINCASH_ENV` | **só servidor** | (opcional, fora da Vercel) `production` bloqueia chave `ps_test_` |
| `CRON_SECRET` | **só servidor** | Protege `/api/cron/expire-orders` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | **só servidor** | E-mail dos ingressos e alertas |
| `LOG_HASH_SECRET` | **só servidor** | (opcional) hash dos IPs de login falho |

Google e SMS são configurados no painel do Supabase, e não no `.env`.

### 7. Deploy na Vercel

1. Crie um **repositório novo** no GitHub e envie esta pasta:
   ```bash
   git init
   git add .
   git commit -m "NO OFF"
   git remote add origin <url-do-novo-repo>
   git push -u origin main
   ```
2. Na Vercel: **Add New → Project** → importe o repositório (framework detectado: Next.js).
3. Em **Settings → Environment Variables**, cadastre as variáveis acima (Production e Preview). Use a chave `ps_test_` do PurinCash só no Preview; em Production, `ps_live_`.
4. Faça o deploy. Depois, atualize:
   - `NEXT_PUBLIC_SITE_URL` com o domínio final;
   - a URL do webhook no PurinCash (`https://<site>/api/webhooks/purincash`);
   - a *Site URL* e as *Redirect URLs* no Supabase.
5. **Cron**: o `vercel.json` agenda `/api/cron/expire-orders` uma vez por dia (limite do plano Hobby). Antes de expirar, ele confere na API do PurinCash as cobranças dos pedidos vencidos (até 40 por execução). O estoque já ignora reservas vencidas em tempo real. No plano Pro, pode ser `*/15 * * * *`.

---

## Venda de ingressos — como funciona

```
Página do evento → lote + quantidade → /checkout (dados do comprador)
  → POST /api/checkout/reserve  → reserve_order(): trava a festa (FOR UPDATE), confere lote/estoque/capacidade,
                                   cria pedido "pending" que segura os ingressos por 10 min
  → POST /api/checkout/pay {method:"pix"} (padrão)
        → POST /v1/charges com o TOTAL DO BANCO em centavos, expiresIn = prazo da reserva,
          callbackUrl, metadata = '{"orderId":"..."}' → QR + copia e cola na tela (polling a cada 4 s)
     ou {method:"card"} (só produção) → POST /v1/card-payments → redireciona para checkoutUrl
        → successUrl = /pedido/[id] (o retorno NÃO confirma nada; a página continua consultando)
     Cobrança pendente do mesmo pedido/método é REUTILIZADA (a API não tem idempotência).
  → POST /api/webhooks/purincash → HMAC-SHA256 do corpo cru (timingSafeEqual) → dedup por X-Webhook-Id
        → confirma por GET (/charges/{id} ou /card-payments/{orderCode}) → apply_payment() → 200 em < 5 s
  → pago: ingressos com QR único + e-mail (após a resposta) + "Meus ingressos" → /pedido/[id]
  Sem webhook: GET /api/orders/[id] e o cron reconciliam pela API.
```

**Status tratados** (em `public.apply_payment`):

| Status no PurinCash | O que acontece |
| --- | --- |
| `paid` | Confere `amountCents` com o total do pedido e emite os ingressos. Repetido não emite em dobro. Valor divergente: pagamento fica `amount_mismatch`, nada é emitido, audit log `critical` e e-mail para o admin. |
| `pending` | Registra a cobrança no pedido. O cartão estende a reserva até o vencimento (30 min). |
| `failed` | A reserva continua até expirar, para o comprador tentar de novo. |
| `expired` | Pedido expira e o estoque é liberado. |
| `refunded` | Pedido estornado e ingressos válidos cancelados (só se for a cobrança que pagou o pedido). |

Outras regras:
- **Pago depois que a reserva expirou e sem estoque**: Pix é reembolsado pela API (`idempotencyKey` = id do pedido); cartão vira ação manual no audit log.
- **Pagamento duplicado** (ex.: pagou o Pix e também o cartão): o excedente é reembolsado (Pix) ou sinalizado para estorno manual (cartão).
- **Pedidos antigos do Mercado Pago** continuam no banco (`provider = 'mercadopago'`, `mp_payment_id` preservado) e aparecem nos relatórios normalmente.

**Lotes** (`public.batch_stock`):
- Os lotes seguem a ordem dentro de cada tipo (pista, meia, VIP, camarote).
- Um lote "passa" quando esgota, é encerrado ou chega ao horário final, e o próximo é liberado sozinho, sem job.
- **Pausar** segura a fila daquele tipo; **Encerrar** libera o próximo.
- Reservas válidas contam no estoque.

**Check-in**:
- `checkin_ticket` trava o ingresso (`FOR UPDATE`), marca como usado e bloqueia reuso, inclusive com duas leituras simultâneas.
- A busca por nome ou CPF inclui a lista VIP (só nomes aprovados entram).

## Visibilidade das festas (super admin)

| Modo | Efeito |
| --- | --- |
| **Oculta** | Não existe para o público: listagens, busca, rankings, sitemap, lista VIP. `/eventos/[slug]` responde **404** (server component). |
| **Visível com informações ocultas** | Toggles independentes: nome, preço, local, quantidade de pessoas. O site mostra "Em breve" / "Revelado em breve". Com preço oculto, as vendas ficam bloqueadas. Com nome oculto, a URL pública vira o id. |
| **Visível** | Tudo aparece. |

**Os campos ocultos não chegam ao navegador:**
- `anon` não tem `SELECT` na tabela `events`.
- O público lê a view `public_events` (`security_barrier`), que devolve `NULL` nos campos ocultos.
- Os lotes públicos vêm de `public_event_batches()`, também mascarada.
- E-mails, "Meus ingressos" e metadados (Open Graph) usam a mesma view.

## Painel do produtor (`/produtor`)

- **Login**: celular (SMS/OTP) ou Google.
- **Festas**: nome, descrição, data/hora, local (casa cadastrada ou local próprio), cidade, categoria, line-up, capa e galeria (bucket `event-images`), capacidade e status.
- **Lotes**: nome, tipo, preço, quantidade, janela de vendas e máximo por pedido. Ações: pausar, retomar, encerrar e editar.
- **Lista VIP**:
  - manual ou importação CSV (`nome;cpf;email;celular;observacao`);
  - observação e limite opcional;
  - links de inscrição com limite e prazo; quem se inscreve entra como pendente e precisa de aprovação.
- **Check-in**: câmera do celular (`@zxing/browser`) e busca por nome/CPF.
- **Vendas em tempo real**: Supabase Realtime + atualização a cada 20 s. Mostra vendidos, reservados, bruto, taxas, líquido, ocupação e check-ins.
- **Relatório final**: CSV, Excel (XLSX) e PDF com:
  - compradores (nome, CPF, e-mail, celular, lote, valor, data, status do pagamento, check-in);
  - lista VIP com presença;
  - faturamento bruto, taxas e líquido, por lote e por forma de pagamento.

## Painel do super admin (`/admin`)

| Aba | Conteúdo |
| --- | --- |
| Festas e visibilidade | Todas as festas, toggles de visibilidade, suspender/reativar, logs por festa |
| Produtores | Lista com vendas, suspender/reativar (as festas saem do site e o painel é bloqueado), logs |
| Vendas | Totais e pedidos da plataforma |
| Usuários | Papel: comprador, produtor ou super admin |
| Demais abas | Catálogo de casas e agenda, moderação de avaliações e denúncias, newsletter, configurações do ranking/selo, segurança (alertas de login) e auditoria |

## Rankings e avaliações (mantidos)

`src/lib/ranking.ts` (espelhado em SQL por `ranking_snapshot`/`get_rankings`):
- **Média bayesiana**: `score = n/(n+m)·R + m/(n+m)·C`.
- Peso de recência com meia-vida configurável.
- Avaliações sinalizadas pesam 0,5; ocultas não contam.

Também ficam: avaliações com 7 critérios, anti-spam, Selo Approved automático, Descobrir, Editorial, Agenda com filtro por dia e cidade, categorias, comunidade, newsletter e páginas institucionais.

## Identidade visual

- **Paleta**: preto `#050505` / `#0A0A0A`, branco `#F5F5F5`, cinza `#A0A0A0`, bordas `#292929`, superfícies `#111111`.
- **Vermelho NO OFF** (tokens em `src/lib/theme.ts` e `tailwind.config.ts`):

  | Token | Cor | Uso | Contraste sobre `#050505` |
  | --- | --- | --- | --- |
  | `red` | `#E10600` | Cor principal: fundos, bordas, brilhos, gradientes, badges | 4,1:1 (AA para texto grande e componentes) |
  | `red-bright` | `#FF3B30` | Links, texto pequeno, foco, estados ativos | 5,7:1 (AA) |
  | `red-deep` | `#B00500` | Estado *active* | — |
  | `red-soft` | — | Fundos suaves | — |

  Nos botões primários o texto é claro sobre o vermelho (4,6:1).
- **Tipografia**: Sora + Manrope.
- **Fotografia**: P&B.

## Estrutura

```
src/
  app/                   rotas (App Router): eventos, checkout, pedido, meus-ingressos, lista/[token],
                         produtor, admin, api/{checkout,orders,webhooks,cron,producer,admin}
  components/            brand, layout, home, cards, tickets, producer, admin, reviews, ui…
  lib/                   ranking, rating, cpf, public-events, vip-csv, brand, theme
  lib/server/            auth, purincash, tickets/{handlers,emails}, platform, reports, mailer, admin
  services/              DataService (Supabase), ticket-service, api-client
supabase/migrations/     0001–0007
tests/                   node:test
```

## Segurança

Veja `SECURITY_AUDIT.md`. Pontos principais:
- Credenciais só em variáveis de ambiente; a service_role e a chave do PurinCash nunca vão ao navegador nem aos logs.
- O webhook é assinado (HMAC do corpo cru + `timingSafeEqual`), deduplicado por `X-Webhook-Id` e sempre confirmado por GET na API.
- O valor cobrado vem do banco.
- Os ingressos só são emitidos por `apply_payment`, que só a `service_role` executa.
- Toda alteração de festa ou lote, mudança de visibilidade, suspensão, pagamento e geração de relatório vai para `audit_logs`, que é imutável.
- Os logs do servidor mascaram e-mail, CPF, telefone, cartão e tokens, inclusive os do MP.
