import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermosPage() {
  return (
    <StaticPage eyebrow="Termos" title="Termos de uso.">
      <p>Modelo de termos. Revise com assessoria jurídica antes do lançamento.</p>
      <h2>1. Conta</h2>
      <p>É necessário ter uma conta para comprar ingressos, avaliar, curtir, favoritar ou publicar conteúdo. Você é responsável pelas informações publicadas.</p>
      <h2>2. Ingressos</h2>
      <p>
        Os ingressos são nominais ao comprador e emitidos somente após a aprovação do pagamento pelo Mercado Pago. Cada ingresso tem um QR
        Code único, válido para uma única entrada; depois do check-in ele é bloqueado. Não compartilhe seus códigos.
      </p>
      <h2>3. Reserva e lotes</h2>
      <p>
        Durante o checkout, os ingressos ficam reservados por 10 minutos (Pix e boleto mantêm a reserva até o vencimento). Os preços seguem os
        lotes definidos pelo produtor e podem mudar quando um lote esgota ou termina.
      </p>
      <h2>4. Cancelamentos e reembolsos</h2>
      <p>
        Pedidos de arrependimento seguem o Código de Defesa do Consumidor e a política do produtor da festa. Em caso de cancelamento do
        evento, o valor é estornado pela mesma forma de pagamento. Ingressos estornados são cancelados automaticamente.
      </p>
      <h2>5. Produtores</h2>
      <p>O produtor é responsável pela realização da festa, pelas informações publicadas e pelo uso dos dados dos compradores apenas para controle de acesso.</p>
      <h2>6. Avaliações</h2>
      <p>Cada pessoa mantém uma avaliação ativa por estabelecimento. Avaliações devem refletir experiências reais. Conteúdo ofensivo, spam, avaliações pagas ou de concorrentes podem ser ocultados pela moderação.</p>
      <h2>7. Estabelecimentos</h2>
      <p>Estabelecimentos não podem alterar ou remover avaliações legítimas. Correções de cadastro são feitas pela equipe NO OFF.</p>
      <h2>8. Selo Approved</h2>
      <p>O selo é concedido automaticamente por critérios públicos e pode ser retirado a qualquer momento se os critérios deixarem de ser atendidos.</p>
    </StaticPage>
  );
}
