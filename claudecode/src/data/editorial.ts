/**
 * Conteúdo editorial de demonstração (textos fictícios escritos para a demo).
 */
export interface Article {
  slug: string;
  title: string;
  kicker: string;
  excerpt: string;
  cover: string;
  author: string;
  date: string;
  readMinutes: number;
  body: string[];
}

export const ARTICLES: Article[] = [
  {
    slug: 'como-calculamos-os-rankings',
    title: 'Como calculamos os rankings',
    kicker: 'Metodologia',
    excerpt: 'Média bayesiana, recência e confiabilidade da amostra: o que está por trás de cada posição.',
    cover: '/images/stage-truss.jpg',
    author: 'Redação Classify',
    date: '2026-11-02',
    readMinutes: 6,
    body: [
      'Uma média simples mente. Uma casa com duas avaliações nota 10 não pode ficar à frente de um clube com trezentas avaliações nota 9.2. Por isso o Classify DJ não ordena os rankings pela maior média.',
      'Usamos uma média bayesiana: cada estabelecimento começa "puxado" para a média geral da plataforma, e só se afasta dela à medida que acumula avaliações. Quanto maior a amostra, mais a nota reflete a opinião real do público.',
      'A recência também pesa. Avaliações recentes contam mais do que avaliações antigas, porque a noite muda rápido: uma reforma de som, uma troca de residente ou uma nova política de filas aparecem no ranking em semanas, não em anos.',
      'Por fim, a confiabilidade. Avaliações denunciadas perdem peso até a moderação decidir, e avaliações removidas por manipulação deixam de contar imediatamente. Cada usuário só mantém uma avaliação ativa por casa — pode atualizá-la, mas não multiplicá-la.',
    ],
  },
  {
    slug: 'o-renascimento-dos-armazens',
    title: 'O renascimento dos armazéns',
    kicker: 'Cena',
    excerpt: 'Como a zona portuária virou o endereço mais disputado da música eletrônica carioca.',
    cover: '/images/warehouse-party.jpg',
    author: 'Redação Classify',
    date: '2026-10-21',
    readMinutes: 8,
    body: [
      'Há dez anos, os galpões da zona portuária eram sinônimo de abandono. Hoje, recebem algumas das festas mais bem avaliadas do país.',
      'A combinação de pé-direito alto, isolamento acústico natural e distância das áreas residenciais transformou os armazéns em palco ideal para pistas longas.',
      'Os produtores apostam em cenografia mínima, luz dramática e som de referência — uma estética que a comunidade recompensa com notas altas em música e ambiente.',
    ],
  },
  {
    slug: 'guia-do-primeiro-festival',
    title: 'Guia do primeiro festival',
    kicker: 'Guia',
    excerpt: 'Do ingresso à volta para casa: o que observar para aproveitar sem perrengue.',
    cover: '/images/festival-stage.jpg',
    author: 'Redação Classify',
    date: '2026-10-08',
    readMinutes: 5,
    body: [
      'Leia as avaliações de organização e filas antes de comprar: é o critério que mais varia entre festivais com line-ups parecidos.',
      'Hidratação, protetor auricular e um ponto de encontro combinado com os amigos resolvem metade dos problemas.',
      'Depois, volte aqui e avalie. A sua experiência ajuda o próximo a escolher melhor.',
    ],
  },
  {
    slug: 'vinil-na-pista',
    title: 'Vinil na pista',
    kicker: 'Cultura',
    excerpt: 'As festas que só tocam discos e por que o público está voltando para elas.',
    cover: '/images/vinyl.jpg',
    author: 'Redação Classify',
    date: '2026-09-27',
    readMinutes: 7,
    body: [
      'Sessões só de vinil voltaram a lotar pequenas pistas em São Paulo e no Rio.',
      'A limitação técnica obriga os DJs a uma curadoria mais cuidadosa — e o público percebe a diferença.',
    ],
  },
  {
    slug: 'o-que-e-o-selo-approved',
    title: 'O que é o selo Approved',
    kicker: 'Classify',
    excerpt: 'Nota mínima, volume de avaliações e integridade: os critérios do selo das melhores festas.',
    cover: '/images/crowd-gold.jpg',
    author: 'Redação Classify',
    date: '2026-09-12',
    readMinutes: 4,
    body: [
      'O selo CLASSIFYDJ APPROVED não pode ser comprado. Ele é concedido automaticamente a quem atinge nota mínima, quantidade mínima de avaliações válidas e não apresenta indícios relevantes de manipulação.',
      'Se a nota cair ou surgirem sinais de fraude, o selo é retirado automaticamente.',
    ],
  },
  {
    slug: 'a-noite-depois-das-seis',
    title: 'A noite depois das seis',
    kicker: 'Tendência',
    excerpt: 'Festas de fim de tarde e pores do sol: a nova primeira etapa da noite.',
    cover: '/images/rooftop-party.jpg',
    author: 'Redação Classify',
    date: '2026-08-30',
    readMinutes: 5,
    body: [
      'O pôr do sol virou programa principal. Festas de domingo à tarde aparecem cada vez mais nos rankings.',
      'Público que chega cedo, deep house e vista para o mar: a fórmula se repete do Arpoador a Jurerê.',
    ],
  },
];
