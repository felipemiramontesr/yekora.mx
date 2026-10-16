import { disciplines, getMessages, type Locale } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { ActivityCard } from '../ActivityCard';
import { BrandBanner } from '../BrandBanner';

export function HomeView({ locale }: Readonly<{ locale: Locale }>) {
  const messages = getMessages(locale);
  const { hero, mexicanTalent } = messages.home;
  return (
    <>
      <section className="bg-petroleo text-marfil">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-[1fr_auto]">
          <div>
            <p className="inline-block border-b-2 border-ocre pb-1 text-sm uppercase tracking-widest">
              {hero.eyebrow}
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-tight md:text-5xl">
              {hero.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-marfil/90">{hero.lede}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a
                href={`${routeFor('home', locale)}#disciplinas`}
                className="rounded-md bg-marfil px-6 py-3 font-semibold text-petroleo"
              >
                {hero.primaryCta}
              </a>
              <a
                href={routeFor('about', locale)}
                className="rounded-md border border-marfil/60 px-6 py-3 font-semibold"
              >
                {hero.secondaryCta}
              </a>
            </div>
          </div>
          {/* Client logo, never retyped. Decorative here: the page h1 carries the message. */}
          <img
            src="/brand/YEKORA_logo_vectorial_marfil.svg"
            alt=""
            width={300}
            height={244}
            className="hidden md:block"
          />
        </div>
      </section>

      <section
        id="disciplinas"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20"
      >
        <h2 className="text-3xl font-semibold">
          {messages.home.disciplines.title}
        </h2>
        <p className="mt-3 text-petroleo/80">
          {messages.home.disciplines.lede}
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {disciplines.map((discipline) => (
            <ActivityCard
              key={discipline}
              discipline={discipline}
              name={messages.disciplines[discipline]}
              levelLabel={messages.activities.levelLabel}
              activity={messages.activities.items[discipline]}
            />
          ))}
        </div>
      </section>

      <BrandBanner messages={messages.brandBanner} />

      <section
        id="marcas-mexicanas"
        className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20"
      >
        <h2 className="text-3xl font-semibold">{mexicanTalent.title}</h2>
        <p className="mt-3 max-w-3xl text-petroleo/80">{mexicanTalent.lede}</p>
        <p className="mt-6 inline-block border-l-4 border-ocre pl-4 text-petroleo">
          {mexicanTalent.note}
        </p>
      </section>
    </>
  );
}
