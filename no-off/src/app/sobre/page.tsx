import type { Metadata } from 'next';
import Link from 'next/link';
import { StaticPage } from '@/components/layout/StaticPage';
import { SLOGAN } from '@/lib/brand';

export const metadata: Metadata = { title: 'Sobre a NO OFF' };

export default function SobrePage() {
  return (
    <StaticPage eyebrow="Sobre a NO OFF" title={`${SLOGAN}.`}>
      <p>
        A NO OFF é uma plataforma de venda de ingressos para a vida noturna. Festas, eventos e casas noturnas em um só lugar: você descobre,
        compara pelas avaliações da comunidade e compra o ingresso com segurança — da boate de bairro ao maior festival do país.
      </p>
      <h2>Ingressos</h2>
      <p>
        O pagamento é processado pelo PurinCash (Pix ou cartão de crédito). O ingresso digital, com QR Code único,
        é emitido somente após a confirmação do pagamento, enviado por e-mail e fica disponível em <Link href="/meus-ingressos">Meus ingressos</Link>.
      </p>
      <h2>Rankings e avaliações</h2>
      <p>
        Cada pessoa avalia sete critérios — música, público, ambiente, bebidas, atendimento, organização e experiência geral. A nota geral é
        calculada pelo servidor, e os rankings usam média bayesiana com peso de recência. <Link href="/editorial/como-calculamos-os-rankings">Leia a metodologia</Link>.
      </p>
      <h2>Independência</h2>
      <p>Estabelecimentos e produtores não pagam por posição, não podem editar nem excluir avaliações legítimas e não compram o Selo Approved.</p>
      <h2>Para produtores</h2>
      <p>
        Produtores criam as próprias festas, configuram lotes, lista VIP e fazem o check-in na portaria pelo <Link href="/produtor">Painel do produtor</Link>.
      </p>
    </StaticPage>
  );
}
