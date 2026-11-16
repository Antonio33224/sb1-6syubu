import type { Metadata } from 'next';
import { ClassifyAIChat } from '@/components/ai/ClassifyAIChat';

export const metadata: Metadata = {
  title: 'Classify AI',
  description: 'Converse com o concierge do Classify DJ e descubra a festa, boate ou evento que combina com você.',
};

export default function ClassifyAIPage() {
  return (
    <section className="container-site py-12 sm:py-16">
      <p className="eyebrow">Concierge · Powered by Claude</p>
      <h1 className="mt-5 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[56px]">Classify AI</h1>
      <p className="mt-4 max-w-xl text-[14px] text-mute">
        Diga como você quer sair e a IA cruza seu pedido com as casas, eventos, preços e notas reais da comunidade do Classify DJ.
      </p>
      <div className="mt-10">
        <ClassifyAIChat />
      </div>
    </section>
  );
}
