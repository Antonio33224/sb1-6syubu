/**
 * BENEFÍCIOS CLASSIFY+ DEMONSTRATIVOS — EXEMPLOS FICTÍCIOS.
 * Não representam acordos reais com nenhum estabelecimento. São criados com
 * `is_demo = true` e exibidos com o rótulo "EXEMPLO" em toda a interface.
 * Benefícios reais são cadastrados pelo administrador (Painel → Benefícios).
 */
export const DEMO_BENEFITS: {
  venueSlug: string;
  title: string;
  description: string;
  rules: string;
  how_to_redeem: string;
  validDays: number;
  total_quantity: number | null;
}[] = [
  {
    venueSlug: 'paradise-club',
    title: 'Entrada antecipada sem fila',
    description: 'Acesso pela entrada lateral até 00h30, sem passar pela fila principal.',
    rules: 'Válido às sextas e sábados. Um acesso por assinante por noite. Sujeito à lotação da casa.',
    how_to_redeem: 'Gere o código e apresente-o na entrada lateral junto com um documento com foto.',
    validDays: 60,
    total_quantity: 150,
  },
  {
    venueSlug: 'concreto',
    title: '20% de desconto no ingresso',
    description: 'Desconto no ingresso de pista para qualquer sessão do mês.',
    rules: 'Não cumulativo com outras promoções. Limitado a 1 ingresso por código.',
    how_to_redeem: 'Informe o código no campo "cupom" da bilheteria oficial da casa.',
    validDays: 30,
    total_quantity: null,
  },
  {
    venueSlug: 'rooftop-360',
    title: 'Drink de cortesia ao pôr do sol',
    description: 'Um drink autoral da casa para chegadas até 18h.',
    rules: 'Válido de quinta a domingo, até 18h. Proibido para menores de 18 anos.',
    how_to_redeem: 'Mostre o código ao bartender ao fazer o primeiro pedido.',
    validDays: 45,
    total_quantity: 80,
  },
  {
    venueSlug: 'velvet-room',
    title: 'Nome na lista VIP',
    description: 'Inclusão na lista VIP com acesso ao mezanino.',
    rules: 'Lista fecha às 22h do dia do evento. Até 1 acompanhante.',
    how_to_redeem: 'Gere o código e envie pelo direct da casa até as 22h.',
    validDays: 21,
    total_quantity: 40,
  },
];
