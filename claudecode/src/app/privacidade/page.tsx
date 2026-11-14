import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Privacidade' };

export default function PrivacidadePage() {
  return (
    <StaticPage eyebrow="Privacidade" title="Política de privacidade.">
      <p>Modelo de política para a fase de demonstração, alinhado à LGPD. Revise com assessoria jurídica antes do lançamento.</p>
      <h2>Dados coletados</h2>
      <p>E-mail (autenticação), nome, nome de usuário, cidade, biografia e foto de perfil opcionais, avaliações, curtidas e favoritos.</p>
      <h2>O que é público</h2>
      <p>Nome, nome de usuário, foto, cidade, biografia e avaliações. Seu e-mail e seus favoritos nunca são exibidos publicamente.</p>
      <h2>Newsletter</h2>
      <p>O e-mail informado na newsletter é usado apenas para o envio de rankings e novidades. Você pode pedir a remoção a qualquer momento.</p>
      <h2>Seus direitos</h2>
      <p>Você pode acessar, corrigir e excluir seus dados. Solicitações: privacidade@classifydj.com.</p>
    </StaticPage>
  );
}
