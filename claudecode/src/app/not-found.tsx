import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="container-site flex min-h-[70vh] flex-col items-start justify-center py-20">
      <p className="eyebrow">Erro 404</p>
      <h1 className="mt-5 font-display text-[56px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[96px]">
        A festa
        <br />
        acabou aqui.
      </h1>
      <p className="mt-6 max-w-md text-mute">A página que você procura não existe ou foi movida.</p>
      <div className="mt-9 flex gap-3">
        <Link href="/" className="btn-primary">Voltar ao início</Link>
        <Link href="/rankings" className="btn-outline">Ver rankings</Link>
      </div>
    </section>
  );
}
