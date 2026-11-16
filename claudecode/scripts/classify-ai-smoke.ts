/**
 * TESTE REAL da Classify AI — chama a API da Anthropic de verdade.
 *
 *   npm run ai:smoke
 *
 * Etapas (cada uma só passa com resposta real; nada é simulado):
 *   1. ANTHROPIC_API_KEY reconhecida pela Anthropic (models.retrieve do modelo configurado)
 *   2. O Claude responde (mensagem simples)
 *   3-5. Conversa de 2 turnos com o banco real: mantém contexto, consulta o Supabase e
 *        todas as recomendações citadas existem no banco
 *        (requer NEXT_PUBLIC_SUPABASE_URL/ANON_KEY e CLASSIFY_AI_TEST_EMAIL/PASSWORD)
 *   6-7. Rota HTTP /api/classify-ai/chat (streaming NDJSON) em um servidor rodando —
 *        local (npm run dev) ou produção na Vercel — definido por CLASSIFY_AI_BASE_URL
 *
 * Variáveis lidas do ambiente ou de .env.local.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { classifyAIConfig, DEFAULT_CLASSIFY_AI_MODEL } from '../src/lib/server/classify-ai/config';
import { ClassifyData, userClient } from '../src/lib/server/classify-ai/data';
import { createAnthropicClient, describeError, runClassifyAI } from '../src/lib/server/classify-ai/engine';
import { nowContext } from '../src/lib/server/classify-ai/prompt';
import { buildMessages, type ChatTurn } from '../src/lib/server/classify-ai/validate';

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* arquivo ausente */
  }
}

let failures = 0;
const ok = (step: string, detail = '') => console.log(`  ✔ ${step}${detail ? ` — ${detail}` : ''}`);
const fail = (step: string, detail: string) => {
  failures++;
  console.log(`  ✘ ${step} — ${detail}`);
};
const skip = (step: string, why: string) => console.log(`  – ${step} — NÃO TESTADO: ${why}`);

async function main() {
  console.log('\nClassify AI — teste real com a API da Anthropic\n');

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.CLASSIFY_AI_MODEL?.trim() || DEFAULT_CLASSIFY_AI_MODEL;
  if (!apiKey) {
    fail('1. API key', 'ANTHROPIC_API_KEY não está definida. Crie a chave em https://platform.claude.com e defina-a em .env.local (local) e nas Environment Variables da Vercel. Nenhum teste foi considerado aprovado.');
    return;
  }

  const anthropic = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });

  // 1. Chave reconhecida + modelo disponível
  try {
    const m = await anthropic.models.retrieve(model);
    ok('1. API key reconhecida', `modelo ${m.id} (${m.display_name}) disponível`);
  } catch (err) {
    fail('1. API key', describeError(err).message);
    return;
  }

  // 2. Claude responde
  try {
    const r = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Responda apenas com a palavra: pronto' }],
    });
    const text = r.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    if (text) ok('2. Claude respondeu', `"${text.slice(0, 60)}" (${r.usage.input_tokens} in / ${r.usage.output_tokens} out)`);
    else fail('2. Claude respondeu', `resposta sem texto (stop_reason=${r.stop_reason})`);
  } catch (err) {
    fail('2. Claude respondeu', describeError(err).message);
    return;
  }

  // 3-5. Conversa com dados reais
  const cfg = classifyAIConfig();
  const email = process.env.CLASSIFY_AI_TEST_EMAIL;
  const password = process.env.CLASSIFY_AI_TEST_PASSWORD;
  let accessToken: string | null = null;
  if (!cfg.ok) {
    skip('3-5. Conversa com o banco', `variáveis ausentes: ${cfg.missing.join(', ')}`);
  } else if (!email || !password) {
    skip('3-5. Conversa com o banco', 'defina CLASSIFY_AI_TEST_EMAIL e CLASSIFY_AI_TEST_PASSWORD (usuário de teste do Supabase)');
  } else {
    const auth = createClient(cfg.config.supabaseUrl, cfg.config.supabaseAnonKey, { auth: { persistSession: false } });
    const { data: session, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !session.session) {
      fail('3. Login do usuário de teste', error?.message ?? 'sem sessão');
    } else {
      accessToken = session.session.access_token;
      const db = userClient(cfg.config.supabaseUrl, cfg.config.supabaseAnonKey, accessToken);
      const now = nowContext();
      const data = new ClassifyData(db, session.user.id, cfg.config.includeDemo, now.today);
      const client = createAnthropicClient(cfg.config);
      const overview = await data.catalogOverview();
      const city = process.env.CLASSIFY_AI_TEST_CITY || overview.cities[0]?.city;
      console.log(`     catálogo: ${overview.total_venues} casas, ${overview.upcoming_events} eventos futuros; cidade de teste: ${city ?? '(nenhuma)'}`);

      const history: ChatTurn[] = [];
      const turn = async (msg: string) => {
        const res = await runClassifyAI({ client, config: cfg.config, data, messages: buildMessages(history, msg), nowText: now.text });
        history.push({ role: 'user', content: msg }, { role: 'assistant', content: res.text });
        return res;
      };

      try {
        const t1 = await turn(`Quero sair sábado em ${city ?? 'minha cidade'}, gosto de eletrônica, quero gastar até R$ 150 e prefiro lugares sofisticados.`);
        const dbCalls = t1.toolCalls.filter((c) => c.name.startsWith('search_') || c.name === 'get_venue_details');
        if (dbCalls.length) ok('4. Banco consultado', dbCalls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join('; '));
        else fail('4. Banco consultado', 'o Claude não chamou nenhuma ferramenta de busca');
        console.log(`\n     --- resposta 1 ---\n${t1.text.replace(/^/gm, '     ')}\n`);

        const t2 = await turn('E se eu baixar o orçamento para até R$ 80?');
        const budgetCall = t2.toolCalls.find((c) => {
          const i = c.input as Record<string, unknown>;
          return (c.name === 'search_venues' && i.max_budget === 80) || (c.name === 'search_events' && i.max_price === 80);
        });
        const carried = t2.toolCalls.some((c) => {
          const i = c.input as Record<string, unknown>;
          return Array.isArray(i.music_styles) && i.music_styles.length > 0;
        });
        const reasked = /qual (é )?(a )?(sua )?cidade|que estilo/i.test(t2.text);
        if (budgetCall && carried && !reasked) ok('3. Contexto mantido', 'novo orçamento aplicado mantendo estilo; nada foi perguntado de novo');
        else fail('3. Contexto mantido', `orçamento=${Boolean(budgetCall)} estilo mantido=${carried} perguntou de novo=${reasked}`);
        console.log(`\n     --- resposta 2 ---\n${t2.text.replace(/^/gm, '     ')}\n`);

        // 5. Toda recomendação citada existe no banco
        const cited = [...t1.sources, ...t2.sources];
        let missing = 0;
        for (const s of cited) {
          const table = s.type === 'venue' ? 'venues' : 'events';
          const { data: row } = await db.from(table).select('id, name').eq('slug', s.slug).maybeSingle();
          if (!row || row.id !== s.id || row.name !== s.name) missing++;
        }
        const bold = [...history.filter((h) => h.role === 'assistant').map((h) => h.content).join('\n').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
        const consulted = new Set([...t1.consulted, ...t2.consulted].map((s) => s.name.toLowerCase()));
        const unknownBold = bold.filter((b) => b.length > 3 && ![...consulted].some((n) => b.toLowerCase().includes(n) || n.includes(b.toLowerCase())));
        if (missing === 0) ok('5. Recomendações batem com o banco', `${cited.length} registros citados, todos encontrados por slug/id/nome`);
        else fail('5. Recomendações batem com o banco', `${missing} registro(s) citados não conferem com o banco`);
        if (unknownBold.length) console.log(`     atenção: destaques em negrito que não são registros consultados (revise): ${unknownBold.join(', ')}`);
      } catch (err) {
        fail('3-5. Conversa com o banco', describeError(err).message);
      }
    }
  }

  // 6-7. Rota HTTP (local ou Vercel)
  const base = process.env.CLASSIFY_AI_BASE_URL?.replace(/\/$/, '');
  if (!base) {
    skip('6-7. Rota /api/classify-ai/chat', 'defina CLASSIFY_AI_BASE_URL (ex.: http://localhost:3000 ou a URL de produção da Vercel)');
  } else if (!accessToken) {
    skip('6-7. Rota /api/classify-ai/chat', 'precisa do login do usuário de teste (etapa 3)');
  } else {
    try {
      const res = await fetch(`${base}/api/classify-ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ message: 'Me indica uma casa bem avaliada para dançar house.', save: false }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const raw = await res.text();
      const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; text?: string; error?: string });
      const err = events.find((e) => e.type === 'error');
      const textChunks = events.filter((e) => e.type === 'text').length;
      if (err) fail('6. Rota respondeu', err.error ?? 'erro');
      else if (events.some((e) => e.type === 'done') && textChunks > 1) ok('6. Rota respondeu em streaming', `${textChunks} blocos de texto recebidos em ${base}`);
      else fail('6. Rota respondeu', `eventos recebidos: ${events.map((e) => e.type).join(',')}`);
      if (/vercel\.app|^https:/.test(base)) ok('7. Ambiente remoto', base);
    } catch (e) {
      fail('6-7. Rota /api/classify-ai/chat', e instanceof Error ? e.message : String(e));
    }
  }
}

main()
  .catch((err) => fail('erro inesperado', err instanceof Error ? err.message : String(err)))
  .finally(() => {
    console.log(failures ? `\n${failures} verificação(ões) falharam.\n` : '\nVerificações executadas passaram (veja as marcadas como NÃO TESTADO).\n');
    process.exit(failures ? 1 : 0);
  });
