# classify**DJ** — We rate the night.

Plataforma premium de avaliação, descoberta e classificação de festas, eventos e casas noturnas.
Next.js 15 · React 19 · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Storage, RLS) · Lucide · Leaflet.

---

## Executar

```bash
npm install
npm run dev          # http://localhost:3000
```

Sem variáveis de ambiente o site sobe em **modo demonstração** (ver abaixo). Para o backend real, configure o Supabase.

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e servidor de produção |
| `npm run typecheck` | Checagem de tipos |
| `npm test` | Testes (node:test): notas/rankings/níveis, Classify+, concierge de voz |
| `npm run db:seed-sql` | Regenera `supabase/seed.sql` a partir dos dados demo |

## Modo demonstração vs. Supabase

O app escolhe o backend em `src/services/index.ts`:

- **Supabase configurado** → `SupabaseService`: Postgres + Auth + Storage. Toda regra sensível roda no banco.
- **Sem credenciais** → `DemoService`: banco local no `localStorage` do navegador, com dados **fictícios** identificados (selo “DEMO” e aviso fixo “Modo demonstração”). Nada é enviado a servidores. Ele **não** finge estar conectado ao Supabase.

Contas de teste no modo demo (senha `classify123`):

- `demo@classifydj.demo` — usuário
- `admin@classifydj.demo` — administrador

## Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, execute `supabase/migrations/0001_classify_schema.sql` (tabelas, índices, constraints, triggers, RLS, RPCs, buckets do Storage), depois `supabase/migrations/0002_venue_prices.sql` (média e faixas de preço por casa; campos opcionais — `NULL` = não informado), `supabase/migrations/0003_classify_plus.sql` (Classify+: assinaturas, preferências, alertas, benefícios, histórico, RLS), `0004_classify_ai.sql`, `0005_voice_assistant.sql` (concierge de voz) e `0006_coupons_grants_audit.sql` (cupons, gratuidades, audit log, alertas de login; a voz passa a exigir Classify+).
3. (Opcional) Execute `supabase/seed.sql` para carregar os dados demonstrativos — rode `npm run db:seed-sql` antes para gerar datas relativas a hoje.
4. Copie `.env.example` para `.env.local` e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

5. Em **Authentication → URL Configuration**, adicione `http://localhost:3000/redefinir-senha` e `http://localhost:3000/perfil` (e os equivalentes de produção) às Redirect URLs.
6. Para tornar alguém administrador: rode `scripts/promote-admin.sql` no SQL Editor (troque o e-mail), saia e entre de novo e acesse `/admin` (menu do avatar → **Painel admin**).

A **service_role key nunca vai para o navegador**: ela é usada só no servidor (webhook/cobrança e registro de falhas de login). Somente a anon key (protegida por RLS) vai para o navegador. Veja `SECURITY_AUDIT.md`.

### Remover dados demonstrativos

- Supabase: `select public.remove_demo_data();` (ou Painel admin → Configurações → Remover dados demo)
- Modo demo: Painel admin → Configurações → Remover dados demo / Redefinir demonstração

## Funcionalidades

- **Home** fiel à composição descrita: header fixo, hero P&B com título “WE RATE THE NIGHT.”, texto vertical, rankings (3 cards), últimas avaliações (destaque + lista + card Approved), newsletter funcional, footer.
- **Rankings** com 7 categorias (geral, boates, festas, festivais, experiências, mais hypadas, em ascensão), escopos (geral, cidade, semana, mês, histórico), filtros de cidade/estado/nota mínima, variação de posição semanal.
- **Avaliações** com 7 critérios ponderados, comentário, fotos (até 4), data da experiência, curtidas, denúncias, edição com histórico de versões, exclusão pelo autor. Login obrigatório, uma avaliação ativa por pessoa e por local.
- **Anti-spam/fraude**: limite de 5 avaliações/hora, bloqueio de links, comentário duplicado entre locais, texto repetitivo, autocurtida/autodenúncia, 3 denúncias → avaliação sinalizada (peso 0,5 no ranking até moderação). Moderação altera só a visibilidade, nunca o conteúdo.
- **Página da casa**: hero, informações, notas por critério, distribuição, avaliações com ordenação, galeria (oficial + comunidade), eventos futuros/passados, mapa, botões Avaliar/Favoritar/Compartilhar/Ver no mapa.
- **Eventos**: página própria, nota da edição separada da nota permanente da casa, comentários pós-evento, favoritos.
- **Descobrir**: atalhos (próximas por geolocalização, semana, fim de semana, festivais, estilos), filtros de local/data/preço/estilo/nota, grade e mapa.
- **Perfil**: níveis automáticos (Beginner 1 · Explorer 5 · Expert 15 · Legend 30), conquistas, histórico, favoritos (privados), edição de dados e foto, troca de senha, sair. Perfil público em `/u/[username]`.
- **Selo CLASSIFYDJ APPROVED** automático, com critérios configuráveis e página explicativa.
- **Painel admin**: métricas, CRUD de casas e eventos, usuários/papéis, moderação de avaliações e denúncias, newsletter (com exportação CSV), estilos musicais, parâmetros do selo e do algoritmo, remoção de dados demo.
- **Auth**: cadastro, login, logout, recuperação e redefinição de senha, sessão persistente, páginas protegidas.

## Classify+ (assinatura premium)

**“Your night. Your ranking.”** Avaliar, enviar fotos e consultar rankings, notas, agenda, preços e cards **Indicado** continuam gratuitos. Assinantes **não** têm peso maior nas avaliações — o ranking público é idêntico para todos.

| Rota | O que é |
| --- | --- |
| `/classify-plus` | Página de vendas (hero, demo do Meu Ranking com dados reais, comparativo, planos, FAQ) |
| `/meu-ranking` | Pesos 0–100 para os 7 critérios; nota = Σ(média pública × peso) ÷ Σpesos (peso 0 é ignorado); até 10 configurações salvas |
| `/descobrir` | Filtros básicos (todos) + **filtros avançados** Classify+ (gasto médio, público, capacidade, horário, dia, tipo, nota por critério, distância) |
| `/alertas` | Seguir DJs/artistas, notificações (histórico, lidas/não lidas), preferências |
| `/pulso` | Avaliações das últimas 6h–7 dias; sem dados → “não há dados recentes” |
| `/retrospectiva` | Básico para todos; completo + card PNG (stories) / WhatsApp para assinantes |
| `/beneficios` | Benefícios em casas parceiras, resgate com código (um por assinante) |
| `/assinatura` | Plano, status, renovação, pagamentos, cancelar/retomar, portal de cobrança |
| `/admin` → Classify+ / Benefícios | Métricas (estimado ≠ recebido) e CRUD de benefícios |
| `/admin` → Cupons / Gratuidades | Cupons de N dias de Classify+ (limite total, por usuário, validade) e gratuidades concedidas/revogadas pelo admin |
| `/admin` → Segurança / Auditoria | E-mail do admin padrão para alertas de login falho (SMTP) e audit log imutável |
| `/assinatura` → Tenho um cupom | Resgate de cupom (gratuidade soma com as anteriores) |

**Planos:** mensal R$ 12,90 (7 dias grátis, uma vez por conta) · anual R$ 109,00 (≈ R$ 9,08/mês, ~30% de economia). Premissa interna (somente no admin): mix 70/30 → ticket ponderado ≈ R$ 11,75.

**Estados:** gratuito · teste grátis · mensal ativa · anual ativa · cancelada (acesso até o fim do período pago) · expirada · pagamento recusado (sem acesso).

### Pagamentos (Stripe)

Escolhido por ter assinaturas recorrentes em BRL, teste grátis nativo, Checkout hospedado, Customer Portal e webhooks assinados. Integração via REST no servidor (sem SDK). Lógica de status isolada em `src/lib/server/billing.ts` para permitir um adaptador Mercado Pago no futuro.

1. Execute `supabase/migrations/0003_classify_plus.sql` no SQL Editor.
2. No Stripe, crie um produto com dois preços recorrentes em BRL (mensal 12,90 e anual 109,00) e preencha `STRIPE_PRICE_MONTHLY`/`STRIPE_PRICE_ANNUAL`. **O teste grátis é aplicado pelo checkout** (não configure trial no preço).
3. Preencha `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (somente servidor).
4. Crie o endpoint de webhook `https://SEU_DOMINIO/api/webhooks/stripe` com os eventos `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`, e copie o segredo para `STRIPE_WEBHOOK_SECRET`. Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
5. Ative o **Customer Portal** no Stripe (cancelamento ao fim do período).

Fluxo: `/api/billing/checkout` cria a sessão → usuário paga no Stripe → o **webhook** (assinatura HMAC validada, idempotente) grava a assinatura → o acesso é liberado. O retorno do checkout apenas aguarda essa confirmação; nenhum pagamento é dado como aprovado sem ela. Nenhum dado de cartão passa pelo Classify DJ.

**Modo demonstração:** o botão de assinar ativa uma assinatura local identificada como demonstração, **sem cobrança e sem registro de pagamento** (há também “Demo: encerrar período agora” para testar a expiração).

### O que depende de configuração externa

- **Cobrança real**: variáveis Stripe acima. Sem elas, a página de planos informa que as assinaturas ainda não estão disponíveis.
- **Alertas por e-mail/push**: preferências e colunas `email_status`/`push_status` prontas; nenhum envio é feito até integrar um provedor (status `not_configured`).
- **Banners de terceiros**: espaço `AdSlot` pronto; em produção só aparece com `NEXT_PUBLIC_ADS_ENABLED=true` e nunca para assinantes.
- **Benefícios**: os demonstrativos são marcados “Exemplo” e não podem ser resgatados no Supabase; cadastre acordos reais no painel.

## Concierge de voz (OpenAI Realtime)

Assistente de voz no estilo Siri que mora num **orbe flutuante** no canto inferior direito de todas as páginas (montado em `app/layout.tsx`). Ele substitui o antigo Classify AI em texto; `/classify-ai` redireciona (301) para a home. A IA **só responde com dados do banco**, via function calling.

**Configuração**

1. Defina `OPENAI_API_KEY` em `.env.local` e nas variáveis de ambiente da Vercel. Nunca use `NEXT_PUBLIC_` para ela.
2. Aplique `supabase/migrations/0004_classify_ai.sql` (conversas salvas) e `0005_voice_assistant.sql` (sessões de voz, rate limit, limite de duração e de consultas).
3. Opcional: `VOICE_MODEL` (padrão `gpt-realtime-2.1`), `VOICE_NAME` (padrão `marin`), `VOICE_TRANSCRIBE_MODEL`, `VOICE_INCLUDE_DEMO`. Os padrões ficam em `src/lib/server/voice/config.ts`.
4. Limites em `platform_settings`: `voice_hourly_sessions` (6), `voice_daily_sessions` (20), `voice_max_session_seconds` (600 = 10 min), `voice_max_tool_calls` (60 por sessão).

Sem a chave a rota responde **503**. Sem o Supabase (modo demonstração) o orbe aparece, mas explica que o concierge fica desativado. Sem login, o orbe pede para entrar.

**Fluxo** (token efêmero → WebRTC → tool calls → banco)

```
navegador                          servidor (Next)                       OpenAI / Supabase
─────────                          ───────────────                       ─────────────────
clique no orbe → getUserMedia
POST /api/voice/session ─────────► auth Supabase + voice_start_session (rate limit no banco)
                                   POST /v1/realtime/client_secrets ───► (OPENAI_API_KEY)
              ◄──────────────────── { client_secret: "ek_…", session_id, max_seconds }
SDP offer ─────────────────────────────────────────────────────────────► POST /v1/realtime/calls (Bearer ek_…)
áudio ⇄ WebRTC · eventos JSON no data channel "oai-events"
function_call (data channel)
POST /api/voice/tool ────────────► voice_register_tool_call (sessão do usuário? ativa? < 10 min? < teto?)
                                   zod → consulta somente leitura com o token do usuário (RLS) ──► Postgres
              ◄──────────────────── { output, cards }
function_call_output + response.create → a IA fala usando só esses dados
```

- `src/lib/server/voice/config.ts`: modelo, voz, instruções de sistema (pt-BR, respostas curtas, ferramenta obrigatória antes de falar de casas/eventos/preços/notas, recusa fora do tema).
- `src/lib/server/voice/tools.ts`: definições das tools + schemas zod + execução. Respostas com só os campos necessários e limite de linhas.
- `src/lib/server/voice/data.ts`: consultas ao Supabase (query builder parametrizado, somente leitura). `djs_seguidos_pelo_usuario` usa o id da **sessão autenticada**, nunca um id vindo da IA.
- `src/lib/server/voice/handlers.ts`: rotas `/api/voice/session`, `/api/voice/tool` e `/api/voice/transcripts` (com dependências injetáveis para testes).
- `src/components/voice/realtime.ts`: WebRTC, data channel, legendas (transcrição de entrada e saída), tool calls, interrupção (VAD do servidor com `interrupt_response`), limite de duração no cliente.
- `src/components/voice/VoiceAssistant.tsx`: orbe e painel (desktop: 420px no canto; mobile: tela cheia), legendas ao vivo, cartões clicáveis dos registros **consultados e citados**, mutar, encerrar, histórico. Atalhos: **Ctrl/Cmd + J** abre/fecha, **Esc** fecha o painel (a conversa continua no orbe). O Ctrl/Cmd + K já é da busca.
- Sem permissão de microfone: campo de texto que manda mensagens para a **mesma sessão realtime** (a resposta continua em voz e legenda).
- **Salvar conversas** é opt-in (desligado por padrão). As transcrições vão para `ai_conversations` (`channel = 'voice'`) e `ai_messages`, privadas por RLS e apagáveis no histórico do painel.

**Animação** (`src/components/voice/particles/`): Three.js carregado por `import()` dinâmico. Geoide = `IcosahedronGeometry` deformada no vertex shader por simplex noise (3 oitavas), renderizado em pontos com fresnel e gradiente pela altura. Partículas GPGPU (ping-pong FBO via `GPUComputationRenderer`): ~50k no desktop, ~20k no mobile, ~12k com `prefers-reduced-motion`. Elas nascem na superfície deformada, saem pela normal, seguem curl noise e envelhecem. Velocidade e emissão acompanham a amplitude do microfone ou da fala da IA. Bloom (`UnrealBloomPass`), blending aditivo e escurecimento por profundidade. Um único `<canvas>` é reaproveitado entre orbe e painel, com DPR ≤ 2, pausando quando a aba fica oculta ou o orbe sai do viewport. As cores vêm de `src/lib/theme.ts`, os mesmos tokens do Tailwind.

**Como adicionar uma tool**

1. Em `tools.ts`, adicione o schema zod em `schemas`, a definição (mesmo `name`) em `VOICE_TOOLS` e o `case` em `executeVoiceTool`, devolvendo `{ output, cards }`.
2. Se precisar de uma consulta nova, crie o método (somente leitura) em `ClassifyData` (`data.ts`) e inclua-o em `VoiceDataSource`.
3. Rode `npm test`: o teste de sincronia falha se definição e schema divergirem. Escreva testes de validação e de "só dados do banco" em `tests/voice-tools.test.ts`.

**Testes:** `npm test` cobre validação de argumentos, somente leitura, "só dados do banco" (Supabase falso em `tests/helpers/fake-supabase.ts`), auth, rate limit, token efêmero sem vazar a chave e tool calls em sessões expiradas. O fluxo de áudio real (WebRTC) é testado manualmente no navegador.

## Como o ranking é calculado

`src/lib/ranking.ts` (espelhado em SQL por `ranking_snapshot`/`get_rankings`):

- **Média bayesiana**: `score = n/(n+m)·R + m/(n+m)·C`, onde C é a média global e m (padrão 10) é configurável.
- **Recência**: peso `max(0.25, 0.5^(idade/meia-vida))`, meia-vida padrão de 180 dias.
- **Confiabilidade**: avaliações ocultas não contam; sinalizadas contam com metade do peso.
- A nota exibida é sempre a média real, junto com o número de avaliações e a posição.
- A nota geral de cada avaliação é recalculada no servidor (`compute_overall_rating` via trigger) — o valor enviado pelo navegador é ignorado.

## Estrutura

```
src/
  app/              rotas (App Router)
  components/       brand, layout, home, cards, actions, reviews, profile, map, ui, providers
  data/             dados demonstrativos (demo-seed.ts) e editorial
  hooks/            useAsync
  lib/              rating, ranking, levels, moderation, format, image
  services/         contrato DataService + DemoService + SupabaseService
  styles/           globals.css (tokens e componentes)
  types/            tipos do domínio
supabase/
  migrations/       schema, RLS, triggers, RPCs, storage
  seed.sql          dados demo gerados
scripts/            gerador do seed SQL
tests/              testes unitários
public/images/      fotografias P&B (Unsplash, dessaturadas)
```

## O que depende de serviços externos

- **Supabase** (banco, auth, storage, e-mails de confirmação/recuperação): exige credenciais. Sem elas, o modo demo cobre todos os fluxos localmente.
- **Envio de e-mails da newsletter**: as inscrições são gravadas na tabela `newsletter`; o disparo exige um provedor de e-mail (não incluso).
- **Tiles do mapa**: OpenStreetMap público, adequado para desenvolvimento. Em produção com volume, use um provedor de tiles com chave própria.
- **Links de ingressos e redes sociais** nos dados demo apontam para endereços de exemplo.

## Identidade visual

Paleta: preto `#050505` / `#0A0A0A`, branco `#F5F5F5`, azul Classify `#83A9F5`, cinza `#A0A0A0`, bordas `#292929`, superfícies `#111111`.
Tipografia: **Sora** (títulos, logotipo, notas) + **Manrope** (texto), auto-hospedadas via `@fontsource`.
Fotografia: P&B de alto contraste (`.photo`) com overlays pretos; uploads coloridos recebem o mesmo tratamento.
