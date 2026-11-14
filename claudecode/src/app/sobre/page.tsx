import type { Metadata } from 'next';
import Link from 'next/link';
import { StaticPage } from '@/components/layout/StaticPage';

export const metadata: Metadata = { title: 'Sobre' };

export default function SobrePage() {
  return (
    <StaticPage eyebrow="Sobre" title="We rate the night.">
      <p>
        O Classify DJ é uma plataforma independente de avaliação e descoberta de festas, eventos e casas noturnas. Reunimos a opinião de quem
        vive a noite para criar rankings confiáveis — da boate de bairro ao maior festival do país.
      </p>
      <h2>Como funciona</h2>
      <p>
        Cada pessoa avalia sete critérios — música, público, ambiente, bebidas, atendimento, organização e experiência geral. A nota geral é
        calculada pelo servidor, e os rankings usam média bayesiana com peso de recência. <Link href="/editorial/como-calculamos-os-rankings">Leia a metodologia</Link>.
      </p>
      <h2>Independência</h2>
      <p>Estabelecimentos não pagam por posição, não podem editar nem excluir avaliações legítimas e não compram o selo Approved.</p>
      <h2 id="demonstracao">Modo demonstração</h2>
      <p>
        Quando o projeto roda sem um banco Supabase configurado, o site funciona em modo demonstração: casas, eventos, usuários e avaliações são
        fictícios, gerados para fins de apresentação, e tudo o que você cria fica salvo apenas neste navegador. Contas de teste: <code>demo@classifydj.demo</code> e{' '}
        <code>admin@classifydj.demo</code>, senha <code>classify123</code>.
      </p>
    </StaticPage>
  );
}
