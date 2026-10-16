import type { Messages } from '@/app/i18n';

interface BrandBannerProps {
  messages: Messages['brandBanner'];
}

const PILLARS = ['seleccion', 'confianza', 'accesibilidad'] as const;

export function BrandBanner({ messages }: Readonly<BrandBannerProps>) {
  return (
    <section id="filosofia" className="scroll-mt-24 bg-petroleo text-marfil">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-semibold">{messages.title}</h2>
        <p className="mt-3 max-w-2xl text-marfil/90">{messages.lede}</p>
        <ul className="mt-10 grid gap-6 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li key={pillar} className="border-t-2 border-ocre pt-4">
              <h3 className="text-lg font-semibold">
                {messages.pillars[pillar].title}
              </h3>
              <p className="mt-2 text-sm text-marfil/90">
                {messages.pillars[pillar].text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
