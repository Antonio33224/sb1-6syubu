import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Contato' };

export default function ContatoPage() {
  return (
    <StaticPage eyebrow="Contato" title="Fale com a gente.">
      <p>Ingressos, produtores, imprensa, parcerias, correções de cadastro ou dúvidas sobre moderação.</p>
      <h2>Ingressos e pedidos</h2>
      <p>Seus ingressos ficam em Meus ingressos e também chegam por e-mail. Para dúvidas sobre um pedido, escreva para <a href="mailto:contato@nooff.com.br">contato@nooff.com.br</a> informando o número do pedido.</p>
      <h2>Produtores</h2>
      <p>Quer vender ingressos das suas festas na NO OFF? Crie sua conta (celular ou Google) e envie o seu @ para <a href="mailto:contato@nooff.com.br">contato@nooff.com.br</a> para liberarmos o painel do produtor.</p>
      <h2>Comunidade e moderação</h2>
      <p>Use o botão “Denunciar” em qualquer avaliação. Cada denúncia é analisada pela equipe.</p>
      <h2>Estabelecimentos</h2>
      <p>Para corrigir informações de cadastro (endereço, horários, links), entre em contato pelo e-mail <a href="mailto:contato@nooff.com.br">contato@nooff.com.br</a>.</p>
      <h2>Imprensa</h2>
      <p><a href="mailto:imprensa@nooff.com.br">imprensa@nooff.com.br</a></p>
    </StaticPage>
  );
}
