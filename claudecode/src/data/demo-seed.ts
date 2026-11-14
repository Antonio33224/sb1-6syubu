/**
 * DADOS DE DEMONSTRAÇÃO — conteúdo fictício.
 *
 * Todos os registros gerados aqui recebem `is_demo = true`.
 * Nomes de casas, festas, usuários e avaliações são inventados e NÃO
 * representam opiniões reais de clientes. A geração é determinística
 * (PRNG com semente fixa) para que demo e seed SQL sejam idênticos.
 *
 * Remoção: no modo demo, "Redefinir/remover dados demo" no painel admin;
 * no Supabase, `select public.remove_demo_data();`.
 */
import { computeOverall, round1, clampScore } from '@/lib/rating';
import { DEFAULT_SETTINGS } from '@/lib/ranking';
import { CRITERIA } from '@/types';
import type {
  EventItem,
  EventReview,
  NewsletterEntry,
  PlatformSettings,
  Profile,
  ReviewLike,
  ReviewReport,
  ReviewRevision,
  Venue,
  VenueReview,
  Favorite,
} from '@/types';

export const DEMO_DB_VERSION = 4;

export interface DemoCredential {
  user_id: string;
  email: string;
  password_hash: string;
}

export interface DemoDB {
  version: number;
  seeded_at: string;
  profiles: Profile[];
  credentials: DemoCredential[];
  venues: Venue[];
  reviews: VenueReview[];
  revisions: ReviewRevision[];
  events: EventItem[];
  eventReviews: EventReview[];
  favorites: Favorite[];
  likes: ReviewLike[];
  reports: ReviewReport[];
  newsletter: NewsletterEntry[];
  settings: PlatformSettings;
}

// Deterministic PRNG (mulberry32)
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID determinístico (formato válido para Postgres). */
function demoUuid(kind: number, n: number): string {
  const hex = (kind * 1_000_000 + n).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

const DAY = 86_400_000;
const img = (name: string) => `/images/${name}.jpg`;

// ---------------------------------------------------------------- venues
interface VenueSeed {
  slug: string;
  name: string;
  category: Venue['category'];
  city: string;
  state: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  cover: string;
  gallery: string[];
  price: number;
  styles: string[];
  days: string[];
  description: string;
  target: number;
  count: number;
  /** Variação da nota ao longo do tempo (positivo = melhorando). */
  trend?: number;
  /** Janela das avaliações em dias. */
  span?: number;
}

const VENUES: VenueSeed[] = [
  {
    slug: 'the-night-edition', name: 'The Night Edition', category: 'festa', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Zona Portuária', address: 'Armazém 5, Av. Rodrigues Alves — Gamboa', lat: -22.8955, lng: -43.1863,
    cover: 'confetti-crowd', gallery: ['festival-stage', 'dj-hands', 'lasers', 'crowd-hearts'], price: 3,
    styles: ['House', 'Techno', 'Eletrônica'], days: ['Sábado'], target: 9.65, count: 44,
    description: 'Festa mensal em armazém restaurado na zona portuária, com sistema de som de referência, line-ups internacionais e uma pista que só esvazia com o sol nascendo.',
  },
  {
    slug: 'summer-experience', name: 'Summer Experience', category: 'festa', city: 'São Paulo', state: 'SP',
    neighborhood: 'Vila Olímpia', address: 'Rua Funchal, 500 — Vila Olímpia', lat: -23.5955, lng: -46.686,
    cover: 'festival-lights', gallery: ['confetti-arena', 'stage-glow', 'friends-drinks'], price: 4,
    styles: ['House', 'Pop', 'Open format'], days: ['Sexta', 'Sábado'], target: 9.4, count: 38,
    description: 'Temporada de verão com cenografia imersiva, open air e convidados que circulam entre o house e o pop. Produção impecável do início ao fim.',
  },
  {
    slug: 'rave-in-the-jungle', name: 'Rave in the Jungle', category: 'festival', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Vargem Grande', address: 'Estrada dos Bandeirantes — Vargem Grande', lat: -22.985, lng: -43.49,
    cover: 'lasers', gallery: ['festival-stage', 'stage-haze', 'confetti-dark'], price: 3,
    styles: ['Techno', 'Eletrônica'], days: ['Edições trimestrais'], target: 9.2, count: 36,
    description: 'Festival de música eletrônica no meio da mata atlântica, com três palcos, estrutura de camping e 24 horas de techno sob as árvores.',
  },
  {
    slug: 'paradise-club', name: 'Paradise Club', category: 'boate', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Barra da Tijuca', address: 'Av. das Américas, 3000 — Barra da Tijuca', lat: -23.0004, lng: -43.3659,
    cover: 'club-tunnel', gallery: ['dj-booth', 'cocktails', 'dance-floor'], price: 3,
    styles: ['House', 'Open format'], days: ['Quinta', 'Sexta', 'Sábado'], target: 9.1, count: 31,
    description: 'Clube de referência na Barra com túnel de LED, pista principal com pé-direito duplo e lounge de coquetelaria assinada.',
  },
  {
    slug: 'festival-tropicalia', name: 'Festival Tropicalia', category: 'festival', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Glória', address: 'Marina da Glória — Glória', lat: -22.9225, lng: -43.1705,
    cover: 'color-festival', gallery: ['crowd-gold', 'stage-truss', 'friends-drinks'], price: 3,
    styles: ['Samba', 'Pop', 'Open format'], days: ['Anual — verão'], target: 8.9, count: 27,
    description: 'Celebração da música brasileira à beira da baía, misturando samba, eletrônica e pop em dois dias de festival.',
  },
  {
    slug: 'club-vibe', name: 'Club Vibe', category: 'boate', city: 'São Paulo', state: 'SP',
    neighborhood: 'Pinheiros', address: 'Rua dos Pinheiros, 1200 — Pinheiros', lat: -23.567, lng: -46.692,
    cover: 'dj-booth', gallery: ['club-red', 'glasses', 'dance-floor'], price: 2,
    styles: ['House', 'Disco'], days: ['Quarta', 'Sexta', 'Sábado'], target: 8.7, count: 24,
    description: 'Casa intimista para 600 pessoas, cabine no centro da pista e programação semanal dedicada ao house e à disco.',
  },
  {
    slug: 'sunset-party', name: 'Sunset Party', category: 'festa', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Ipanema', address: 'Arpoador — Ipanema', lat: -22.9887, lng: -43.1915,
    cover: 'rooftop-party', gallery: ['drinks-toast', 'crowd-gold', 'friends-drinks'], price: 2,
    styles: ['House', 'Open format'], days: ['Domingo'], target: 8.5, count: 22,
    description: 'O pôr do sol mais disputado da cidade: festa de domingo com deep house, vista para o mar e público que chega cedo.',
  },
  {
    slug: 'velvet-room', name: 'Velvet Room', category: 'boate', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Botafogo', address: 'Rua Voluntários da Pátria, 300 — Botafogo', lat: -22.9519, lng: -43.1873,
    cover: 'club-red', gallery: ['cocktails', 'dj-hands', 'glasses'], price: 3,
    styles: ['Hip-hop', 'Trap', 'Open format'], days: ['Sexta', 'Sábado'], target: 8.3, count: 19,
    description: 'Clube de veludo vermelho e iluminação baixa, dedicado ao hip-hop e ao open format, com mesas e pista compacta.',
  },
  {
    slug: 'concreto', name: 'Concreto', category: 'boate', city: 'São Paulo', state: 'SP',
    neighborhood: 'Barra Funda', address: 'Rua Brigadeiro Galvão, 800 — Barra Funda', lat: -23.526, lng: -46.666,
    cover: 'warehouse-party', gallery: ['warehouse-dj', 'lasers', 'concert-red'], price: 2,
    styles: ['Techno'], days: ['Sexta', 'Sábado'], target: 8.8, count: 29,
    description: 'Galpão industrial dedicado ao techno, com som calibrado, proibição de fotos na pista e sessões que passam das 12 horas.',
  },
  {
    slug: 'noir-club', name: 'Noir Club', category: 'boate', city: 'São Paulo', state: 'SP',
    neighborhood: 'Itaim Bibi', address: 'Rua Joaquim Floriano, 400 — Itaim Bibi', lat: -23.585, lng: -46.676,
    cover: 'laser-red', gallery: ['club-tunnel', 'cocktails'], price: 4,
    styles: ['House', 'Pop'], days: ['Quinta', 'Sábado'], target: 7.6, count: 17, trend: 2.2,
    description: 'Clube premium que passou por reformulação completa de som e atendimento; as avaliações recentes refletem a nova fase.',
  },
  {
    slug: 'baile-da-lapa', name: 'Baile da Lapa', category: 'festa', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Lapa', address: 'Rua do Lavradio — Lapa', lat: -22.9135, lng: -43.1795,
    cover: 'crowd-faces', gallery: ['crowd-hearts', 'concert-red'], price: 1,
    styles: ['Funk', 'Hip-hop'], days: ['Sexta'], target: 8.1, count: 21,
    description: 'Baile de sexta-feira sob os arcos, com funk, MCs convidados e a energia mais democrática da noite carioca.',
  },
  {
    slug: 'estacao-22', name: 'Estação 22', category: 'boate', city: 'Belo Horizonte', state: 'MG',
    neighborhood: 'Savassi', address: 'Rua Pernambuco, 1000 — Savassi', lat: -19.939, lng: -43.935,
    cover: 'warehouse-dj', gallery: ['dj-booth', 'dance-floor'], price: 2,
    styles: ['Techno', 'House'], days: ['Sexta', 'Sábado'], target: 7.9, count: 12,
    description: 'Antiga estação de bondes convertida em clube, referência da cena eletrônica mineira.',
  },
  {
    slug: 'ilha-sound', name: 'Ilha Sound', category: 'festival', city: 'Florianópolis', state: 'SC',
    neighborhood: 'Jurerê', address: 'Praia de Jurerê Internacional', lat: -27.44, lng: -48.495,
    cover: 'festival-stage', gallery: ['confetti-arena', 'stage-glow'], price: 4,
    styles: ['Eletrônica', 'House'], days: ['Réveillon e Carnaval'], target: 8.6, count: 16,
    description: 'Festival de praia com palco sobre a areia e headliners da música eletrônica nas datas mais disputadas do ano.',
  },
  {
    slug: 'rooftop-360', name: 'Rooftop 360', category: 'experiencia', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Copacabana', address: 'Av. Atlântica, 1700 — Copacabana', lat: -22.9711, lng: -43.1822,
    cover: 'drinks-toast', gallery: ['glasses', 'cocktails', 'rooftop-party'], price: 4,
    styles: ['House', 'Disco'], days: ['Quinta a domingo'], target: 8.4, count: 14,
    description: 'Terraço com vista 360° da orla, DJ sets ao fim da tarde e coquetelaria autoral.',
  },
  {
    slug: 'selva-sessions', name: 'Selva Sessions', category: 'experiencia', city: 'São Paulo', state: 'SP',
    neighborhood: 'Pinheiros', address: 'Rua Fradique Coutinho — Pinheiros', lat: -23.5615, lng: -46.6895,
    cover: 'dance-floor', gallery: ['vinyl', 'dj-hands'], price: 2,
    styles: ['House', 'Disco'], days: ['Mensal'], target: 9.0, count: 7,
    description: 'Sessões só de vinil em local secreto revelado no dia. Poucas avaliações ainda — repare como a média bayesiana trata a amostra pequena.',
  },
  {
    slug: 'bloco-underground', name: 'Bloco Underground', category: 'festa', city: 'São Paulo', state: 'SP',
    neighborhood: 'Centro', address: 'Rua Augusta — Centro', lat: -23.548, lng: -46.6455,
    cover: 'crowd-hearts', gallery: ['microphone', 'crowd-faces'], price: 1,
    styles: ['Hip-hop', 'Trap'], days: ['Sábado'], target: 7.8, count: 13,
    description: 'Festa de rua e de porão dedicada ao rap nacional, batalhas de MCs e trap.',
  },
  {
    slug: 'mare-alta', name: 'Maré Alta', category: 'festa', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Santa Teresa', address: 'Largo do Guimarães — Santa Teresa', lat: -22.9213, lng: -43.1876,
    cover: 'stage-haze', gallery: ['performer-smoke', 'friends-drinks'], price: 2,
    styles: ['Open format', 'Funk', 'Pop'], days: ['Sábado'], target: 8.4, count: 9, trend: 2.6, span: 70,
    description: 'Festa nova em casarão de Santa Teresa. Começou com problemas de fila, mas as últimas edições estão entre as mais comentadas.',
  },
  {
    slug: 'galpao-zero', name: 'Galpão Zero', category: 'boate', city: 'Rio de Janeiro', state: 'RJ',
    neighborhood: 'Gamboa', address: 'Rua da Gamboa — Gamboa', lat: -22.8985, lng: -43.1925,
    cover: 'concert-red', gallery: ['guitarist-beams', 'band-blue'], price: 1,
    styles: ['Techno', 'Eletrônica'], days: ['Sábado'], target: 6.9, count: 11, trend: -1.2,
    description: 'Galpão alternativo com programação irregular. A comunidade aponta problemas recentes de organização e filas.',
  },
];

// ---------------------------------------------------------------- users
const FIRST = ['Ana', 'Bruno', 'Camila', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcelo', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Valentina', 'Vinícius', 'Yasmin', 'Lucas', 'Mariana', 'Pedro'];
const LAST = ['Ferraz', 'Monteiro', 'Siqueira', 'Barreto', 'Lacerda', 'Pacheco', 'Teixeira', 'Rangel', 'Coutinho', 'Valente', 'Moraes', 'Amaral'];
const CITIES = ['Rio de Janeiro', 'Rio de Janeiro', 'Rio de Janeiro', 'São Paulo', 'São Paulo', 'Belo Horizonte', 'Florianópolis', 'Niterói'];
const BIOS = [
  'Pista até o fim, sempre perto da cabine.',
  'House music e coquetel bem feito. Avalio com sinceridade.',
  'Colecionador de pores do sol e de line-ups.',
  'Techno é estilo de vida.',
  'Funk, hip-hop e tudo que faz a pista pular.',
  'Viajo para dançar. Já são mais de 80 festivais.',
  null,
];

// ---------------------------------------------------------------- comments
const COMMENTS: Record<'top' | 'good' | 'mid' | 'low', string[]> = {
  top: [
    'Som impecável do início ao fim, a pista estava no ponto certo a noite inteira.',
    'Uma das melhores noites do ano. Line-up coerente e transições muito bem feitas.',
    'Público educado, ambiente bonito e iluminação cinematográfica. Volto com certeza.',
    'Organização exemplar: entrada rápida, bar sem filas e equipe atenciosa.',
    'O sistema de som é de outro nível. Dá para sentir cada detalhe do grave.',
    'Experiência completa, do acolhimento na porta ao último set ao amanhecer.',
    'Curadoria musical acima da média. Saí conhecendo três artistas novos.',
  ],
  good: [
    'Noite muito boa, apenas os drinks poderiam ser um pouco mais baratos.',
    'Pista animada e som bom. A fila na entrada demorou uns 30 minutos.',
    'Ambiente lindo e público bacana. O banheiro poderia ser melhor sinalizado.',
    'DJs muito bons, mas a casa estava cheia demais depois das 2h.',
    'Vale a visita. Atendimento simpático e música consistente.',
    'Gostei bastante da proposta, só senti falta de mais variedade no bar.',
  ],
  mid: [
    'Experiência ok. A música agradou, mas a organização deixou a desejar.',
    'Preços altos para o que entrega. O som estava abafado em parte da pista.',
    'Fila longa e atendimento lento no bar. A música salvou a noite.',
    'Já foi melhor. O público mudou e o ambiente ficou mais apertado.',
  ],
  low: [
    'Muita espera para entrar e bar desorganizado. Não recomendo por enquanto.',
    'Som estourando e falta de ventilação. Esperava bem mais.',
    'Superlotado, sem controle de capacidade. Saí antes da metade.',
  ],
};

const EVENT_COMMENTS = [
  'Edição histórica, o encerramento foi emocionante.',
  'Line-up excelente, mas a saída foi confusa.',
  'Produção caprichada e público incrível.',
  'Bom evento, só o som do palco secundário que falhou.',
  'Melhor edição até agora.',
];

// ---------------------------------------------------------------- events
interface EventSeed {
  slug: string;
  name: string;
  venue: string;
  offsetDays: number;
  time: string;
  price: number | null;
  djs: string[];
  styles: string[];
  cover: string;
  description: string;
}

const EVENTS: EventSeed[] = [
  { slug: 'the-night-edition-vol-24', name: 'The Night Edition Vol. 24', venue: 'the-night-edition', offsetDays: 6, time: '23:00', price: 180, djs: ['Lia Monteverde', 'Kaio Draxler', 'Mira Sol'], styles: ['House', 'Techno'], cover: 'festival-stage', description: 'A 24ª edição ocupa os dois armazéns com palco principal em formato 360° e encerramento ao nascer do sol.' },
  { slug: 'summer-experience-opening', name: 'Summer Experience — Opening', venue: 'summer-experience', offsetDays: 9, time: '22:00', price: 220, djs: ['Dante Rios', 'Nina Valença'], styles: ['House', 'Pop'], cover: 'confetti-arena', description: 'Abertura oficial da temporada de verão com nova cenografia e convidados especiais.' },
  { slug: 'rave-in-the-jungle-equinox', name: 'Rave in the Jungle — Equinox', venue: 'rave-in-the-jungle', offsetDays: 20, time: '16:00', price: 290, djs: ['Orfeu', 'Klara Vey', 'Selvagem B2B Tarso'], styles: ['Techno'], cover: 'lasers', description: '24 horas de techno em três palcos na mata, com camping e área de descompressão.' },
  { slug: 'paradise-saturdays', name: 'Paradise Saturdays', venue: 'paradise-club', offsetDays: 2, time: '23:30', price: 120, djs: ['Rafa Leme', 'Juno'], styles: ['House', 'Open format'], cover: 'club-tunnel', description: 'O sábado da Barra com residentes da casa e convidado surpresa.' },
  { slug: 'concreto-12-horas', name: 'Concreto 12 Horas', venue: 'concreto', offsetDays: 5, time: '23:59', price: 90, djs: ['Vera Kloss', 'Hollow', 'Matheus Ferro'], styles: ['Techno'], cover: 'warehouse-party', description: 'Maratona de techno com proibição de fotos na pista e som recalibrado.' },
  { slug: 'sunset-party-domingo', name: 'Sunset Party — Domingo', venue: 'sunset-party', offsetDays: 3, time: '16:00', price: 70, djs: ['Brisa', 'Leo Arpoador'], styles: ['House'], cover: 'rooftop-party', description: 'Deep house do fim da tarde até as 22h, com vista para o mar.' },
  { slug: 'baile-da-lapa-especial', name: 'Baile da Lapa Especial', venue: 'baile-da-lapa', offsetDays: 1, time: '23:00', price: 40, djs: ['DJ Caveirinha', 'MC Aurora'], styles: ['Funk'], cover: 'crowd-faces', description: 'Edição especial com MCs convidados e pista aberta sob os arcos.' },
  { slug: 'club-vibe-disco-night', name: 'Disco Night', venue: 'club-vibe', offsetDays: 4, time: '23:00', price: 80, djs: ['Gil Mirage', 'Tati Groove'], styles: ['Disco', 'House'], cover: 'dj-booth', description: 'Noite dedicada à disco music com sets só de vinil.' },
  { slug: 'velvet-hip-hop-night', name: 'Velvet Hip-Hop Night', venue: 'velvet-room', offsetDays: 8, time: '23:30', price: 100, djs: ['DJ Kairo', 'Lena B'], styles: ['Hip-hop', 'Trap'], cover: 'club-red', description: 'O melhor do hip-hop e do trap com mesas reservadas e pista compacta.' },
  { slug: 'tropicalia-2027', name: 'Festival Tropicalia 2027', venue: 'festival-tropicalia', offsetDays: 45, time: '14:00', price: 340, djs: ['Orquestra Maré', 'Benjamim Sá', 'Duo Palmeira'], styles: ['Samba', 'Pop'], cover: 'color-festival', description: 'Dois dias de música brasileira à beira da baía de Guanabara.' },
  { slug: 'mare-alta-casarao', name: 'Maré Alta no Casarão', venue: 'mare-alta', offsetDays: 13, time: '22:00', price: 60, djs: ['Iara', 'Pedro Bonde'], styles: ['Open format', 'Funk'], cover: 'stage-haze', description: 'Nova edição no casarão com pista dupla e controle de capacidade.' },
  { slug: 'ilha-sound-reveillon', name: 'Ilha Sound Réveillon', venue: 'ilha-sound', offsetDays: 47, time: '21:00', price: 650, djs: ['Headliner a anunciar', 'Coral Beat'], styles: ['Eletrônica', 'House'], cover: 'confetti-dark', description: 'Virada do ano na areia de Jurerê com palco sobre o mar.' },
  // passadas (com avaliações de edição)
  { slug: 'the-night-edition-vol-23', name: 'The Night Edition Vol. 23', venue: 'the-night-edition', offsetDays: -24, time: '23:00', price: 160, djs: ['Mira Sol', 'Teo Lune'], styles: ['House', 'Techno'], cover: 'confetti-crowd', description: 'Edição de primavera com estreia do novo sistema de som.' },
  { slug: 'rave-in-the-jungle-solstice', name: 'Rave in the Jungle — Solstice', venue: 'rave-in-the-jungle', offsetDays: -58, time: '16:00', price: 260, djs: ['Orfeu', 'Hollow'], styles: ['Techno'], cover: 'stage-haze', description: 'Edição de inverno com 22 horas de duração.' },
  { slug: 'summer-experience-closing', name: 'Summer Experience — Closing', venue: 'summer-experience', offsetDays: -40, time: '22:00', price: 200, djs: ['Dante Rios'], styles: ['House'], cover: 'stage-glow', description: 'Encerramento da temporada anterior.' },
];

// ---------------------------------------------------------------- builder
export const DEMO_PASSWORD = 'classify123';
export const DEMO_ADMIN_EMAIL = 'admin@classifydj.demo';
export const DEMO_USER_EMAIL = 'demo@classifydj.demo';

export function buildDemoDatabase(nowMs = Date.now()): Omit<DemoDB, 'credentials'> & {
  credentialSeeds: { user_id: string; email: string; password: string }[];
} {
  const rand = prng(20261114);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
  const iso = (ms: number) => new Date(ms).toISOString();

  // Profiles
  const profiles: Profile[] = [];
  const admin: Profile = {
    id: demoUuid(1, 0), username: 'classify', full_name: 'Equipe Classify', avatar_url: null, city: 'Rio de Janeiro',
    bio: 'Conta administrativa de demonstração.', role: 'admin', is_demo: true, created_at: iso(nowMs - 400 * DAY),
  };
  const demoUser: Profile = {
    id: demoUuid(1, 1), username: 'noite.demo', full_name: 'Visitante Demo', avatar_url: null, city: 'Rio de Janeiro',
    bio: 'Conta de demonstração para testar avaliações, curtidas e favoritos.', role: 'user', is_demo: true,
    created_at: iso(nowMs - 120 * DAY),
  };
  profiles.push(admin, demoUser);

  const used = new Set<string>();
  for (let i = 0; i < 52; i++) {
    let first: string, last: string, key: string;
    do {
      first = pick(FIRST);
      last = pick(LAST);
      key = `${first} ${last}`;
    } while (used.has(key));
    used.add(key);
    const username = `${first}.${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    profiles.push({
      id: demoUuid(1, i + 10), username, full_name: key, avatar_url: null, city: pick(CITIES), bio: pick(BIOS),
      role: 'user', is_demo: true, created_at: iso(nowMs - (200 + Math.floor(rand() * 400)) * DAY),
    });
  }
  const community = profiles.slice(2);
  const power = community.slice(0, 4); // usuários muito ativos

  // Venues
  const venues: Venue[] = VENUES.map((v, i) => ({
    id: demoUuid(2, i + 1), name: v.name, slug: v.slug, description: v.description, category: v.category,
    city: v.city, state: v.state, neighborhood: v.neighborhood, address: v.address, latitude: v.lat, longitude: v.lng,
    cover_image: img(v.cover), gallery: v.gallery.map(img), instagram_url: `https://instagram.com/${v.slug.replace(/-/g, '')}`,
    website_url: null, price_range: v.price, music_styles: v.styles, opening_days: v.days, approved: false,
    is_demo: true, created_at: iso(nowMs - 420 * DAY),
  }));

  // Reviews
  const reviews: VenueReview[] = [];
  let reviewN = 0;
  VENUES.forEach((vs, vi) => {
    const venue = venues[vi]!;
    const authors: Profile[] = [];
    for (const p of power) if (rand() < 0.85) authors.push(p);
    const pool = community.filter((p) => !authors.includes(p)).sort(() => rand() - 0.5);
    while (authors.length < vs.count) authors.push(pool.pop()!);
    if (vs.slug === 'the-night-edition' || vs.slug === 'concreto' || vs.slug === 'sunset-party') authors[authors.length - 1] = demoUser;

    const span = vs.span ?? 330;
    authors.forEach((author, k) => {
      // 0 antigo … 1 recente. Casas "em transformação" (trend) concentram mais avaliações recentes.
      const t = Math.pow(rand(), vs.trend ? 0.3 : 0.8);
      const ageDays = (1 - t) * span + rand() * 0.9;
      const created = nowMs - ageDays * DAY;
      const center = vs.target + (vs.trend ?? 0) * (t - 0.5);
      const scores = Object.fromEntries(
        CRITERIA.map((c) => {
          const bias = c.key === 'drinks_rating' ? -0.5 : c.key === 'organization_rating' ? -0.25 : c.key === 'music_rating' ? 0.25 : 0;
          const noise = (rand() + rand() + rand() - 1.5) * 1.1;
          return [c.key, Math.round(clampScore(center + bias + noise))];
        }),
      ) as Record<(typeof CRITERIA)[number]['key'], number>;
      const overall = computeOverall(scores);
      const band = overall >= 9 ? 'top' : overall >= 7.5 ? 'good' : overall >= 5.5 ? 'mid' : 'low';
      const c1 = pick(COMMENTS[band]);
      let c2 = pick(COMMENTS[band]);
      if (c2 === c1) c2 = '';
      const expDate = new Date(created - Math.floor(rand() * 3) * DAY).toISOString().slice(0, 10);
      reviews.push({
        id: demoUuid(3, ++reviewN), user_id: author.id, venue_id: venue.id, ...scores, overall_rating: overall,
        comment: [c1, c2].filter(Boolean).join(' '), experience_date: expDate, photos: k % 9 === 0 ? [venue.gallery[0]!] : [],
        status: 'published', is_demo: true, created_at: iso(created), updated_at: iso(created),
      });
    });
  });

  // Likes
  const likes: ReviewLike[] = [];
  let likeN = 0;
  for (const r of reviews) {
    const n = Math.floor(Math.pow(rand(), 2.2) * 16);
    const likers = community.filter((p) => p.id !== r.user_id).sort(() => rand() - 0.5).slice(0, n);
    const created = new Date(r.created_at).getTime();
    for (const p of likers) {
      const at = Math.min(nowMs - 60_000, created + rand() * 20 * DAY);
      likes.push({ id: demoUuid(4, ++likeN), user_id: p.id, review_id: r.id, created_at: iso(at) });
    }
  }

  // Events
  const events: EventItem[] = EVENTS.map((e, i) => {
    const venue = venues.find((v) => v.slug === e.venue)!;
    return {
      id: demoUuid(5, i + 1), venue_id: venue.id, name: e.name, slug: e.slug, description: e.description,
      cover_image: img(e.cover), event_date: new Date(nowMs + e.offsetDays * DAY).toISOString().slice(0, 10),
      start_time: e.time, ticket_price: e.price, ticket_url: e.offsetDays > 0 ? `https://example.com/ingressos/${e.slug}` : null,
      dj_names: e.djs, music_styles: e.styles, is_demo: true, created_at: iso(nowMs - 60 * DAY),
    };
  });

  const eventReviews: EventReview[] = [];
  let erN = 0;
  events
    .filter((e) => new Date(e.event_date).getTime() < nowMs)
    .forEach((e) => {
      const n = 4 + Math.floor(rand() * 6);
      community.slice().sort(() => rand() - 0.5).slice(0, n).forEach((p) => {
        eventReviews.push({
          id: demoUuid(6, ++erN), user_id: p.id, event_id: e.id, rating: round1(Math.min(10, 7.8 + rand() * 2.2)),
          comment: pick(EVENT_COMMENTS), is_demo: true,
          created_at: iso(new Date(`${e.event_date}T12:00:00`).getTime() + (1 + rand() * 4) * DAY),
        });
      });
    });

  // Favorites of the demo user
  const favorites: Favorite[] = ['the-night-edition', 'concreto', 'sunset-party', 'rave-in-the-jungle'].map((slug, i) => ({
    id: demoUuid(7, i + 1), user_id: demoUser.id, venue_id: venues.find((v) => v.slug === slug)!.id, event_id: null,
    created_at: iso(nowMs - (30 - i) * DAY),
  }));

  // Reports pending moderation
  const lowReviews = reviews.filter((r) => r.overall_rating < 7).slice(0, 2);
  const reports: ReviewReport[] = lowReviews.map((r, i) => ({
    id: demoUuid(8, i + 1), user_id: community[10 + i]!.id, review_id: r.id,
    reason: i === 0 ? 'Parece avaliação de concorrente.' : 'Linguagem ofensiva no comentário.', status: 'pending',
    created_at: iso(nowMs - (2 + i) * DAY),
  }));

  return {
    version: DEMO_DB_VERSION,
    seeded_at: iso(nowMs),
    profiles,
    credentialSeeds: [
      { user_id: admin.id, email: DEMO_ADMIN_EMAIL, password: DEMO_PASSWORD },
      { user_id: demoUser.id, email: DEMO_USER_EMAIL, password: DEMO_PASSWORD },
    ],
    venues,
    reviews,
    revisions: [],
    events,
    eventReviews,
    favorites,
    likes,
    reports,
    newsletter: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
