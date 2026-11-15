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
| `npm test` | Testes do motor de notas/rankings/níveis (node:test) |
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
2. No **SQL Editor**, execute `supabase/migrations/0001_classify_schema.sql` (tabelas, índices, constraints, triggers, RLS, RPCs, buckets do Storage) e depois `supabase/migrations/0002_venue_prices.sql` (média e faixas de preço por casa; campos opcionais — `NULL` = não informado).
3. (Opcional) Execute `supabase/seed.sql` para carregar os dados demonstrativos — rode `npm run db:seed-sql` antes para gerar datas relativas a hoje.
4. Copie `.env.example` para `.env.local` e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

5. Em **Authentication → URL Configuration**, adicione `http://localhost:3000/redefinir-senha` e `http://localhost:3000/perfil` (e os equivalentes de produção) às Redirect URLs.
6. Para tornar alguém administrador: `update public.profiles set role = 'admin' where username = 'seu.usuario';`

A **service_role key nunca é usada** pelo app. Somente a anon key (protegida por RLS) vai para o navegador.

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
