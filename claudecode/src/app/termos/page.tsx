import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermosPage() {
  return (
    <StaticPage eyebrow="Termos" title="Termos de uso.">
      <p>Modelo de termos para a fase de demonstração. Revise com assessoria jurídica antes do lançamento.</p>
      <h2>1. Conta</h2>
      <p>É necessário ter uma conta para avaliar, curtir, favoritar ou publicar conteúdo. Você é responsável pelas informações publicadas.</p>
      <h2>2. Avaliações</h2>
      <p>Cada pessoa mantém uma avaliação ativa por estabelecimento. Avaliações devem refletir experiências reais. Conteúdo ofensivo, spam, avaliações pagas ou de concorrentes podem ser ocultados pela moderação.</p>
      <h2>3. Estabelecimentos</h2>
      <p>Estabelecimentos não podem alterar ou remover avaliações legítimas. Correções de cadastro são feitas pela equipe Classify.</p>
      <h2>4. Selo Approved</h2>
      <p>O selo é concedido automaticamente por critérios públicos e pode ser retirado a qualquer momento se os critérios deixarem de ser atendidos.</p>
    </StaticPage>
  );
}
