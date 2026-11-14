import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Contato' };

export default function ContatoPage() {
  return (
    <StaticPage eyebrow="Contato" title="Fale com a gente.">
      <p>Imprensa, parcerias, correções de cadastro ou dúvidas sobre moderação.</p>
      <h2>Comunidade e moderação</h2>
      <p>Use o botão “Denunciar” em qualquer avaliação. Cada denúncia é analisada pela equipe.</p>
      <h2>Estabelecimentos</h2>
      <p>Para corrigir informações de cadastro (endereço, horários, links), entre em contato pelo e-mail <a href="mailto:contato@classifydj.com">contato@classifydj.com</a>.</p>
      <h2>Imprensa</h2>
      <p><a href="mailto:imprensa@classifydj.com">imprensa@classifydj.com</a></p>
    </StaticPage>
  );
}
