import type { Metadata } from 'next';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Privacidade' };

export default function PrivacidadePage() {
  return (
    <StaticPage eyebrow="Privacidade" title="Política de privacidade.">
      <p>Modelo de política alinhado à LGPD. Revise com assessoria jurídica antes do lançamento.</p>
      <h2>Dados coletados</h2>
      <p>
        Conta: e-mail ou celular (autenticação), nome, nome de usuário e, opcionalmente, cidade, biografia e foto. Comunidade: avaliações,
        curtidas e favoritos. Compras: nome completo, CPF, e-mail e celular do comprador, itens do pedido e status do pagamento.
      </p>
      <h2>Pagamentos</h2>
      <p>
        Os pagamentos são feitos por Pix e processados pela MisticPay. Para emitir a cobrança compartilhamos seu nome e CPF com a MisticPay, como
        exige o Pix. O pagamento acontece no app do seu banco; recebemos apenas a confirmação e o valor.
      </p>
      <h2>Compartilhamento com o produtor</h2>
      <p>
        Para controle de acesso e prestação de contas, o produtor da festa recebe a lista de compradores daquela festa (nome, CPF, e-mail,
        celular, lote, valor, status do pagamento e check-in) e a lista VIP que ele administra. Ele não tem acesso a compras de outras festas.
      </p>
      <h2>O que é público</h2>
      <p>Nome, nome de usuário, foto, cidade, biografia e avaliações. E-mail, celular, CPF, compras e favoritos nunca são exibidos publicamente.</p>
      <h2>Newsletter</h2>
      <p>O e-mail informado na newsletter é usado apenas para o envio de agenda, rankings e novidades. Você pode pedir a remoção a qualquer momento.</p>
      <h2>Seus direitos</h2>
      <p>Você pode acessar, corrigir e excluir seus dados (respeitados os prazos legais de guarda de registros fiscais). Solicitações: privacidade@nooff.com.br.</p>
    </StaticPage>
  );
}
