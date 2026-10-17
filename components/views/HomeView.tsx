import { ArrowRight, Compass } from 'lucide-react';
import { disciplines, getMessages, type Locale } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { ActivityCard } from '../ActivityCard';
import { BrandBanner } from '../BrandBanner';

/**
 * Hero backdrop (FC 004): original thin-line drawing, three mountain ridges and a set of
 * contour lines, in the brand's line style. It is not traced from the client's manual.
 *
 * Contrast invariant (FC 004, I-HeroContrast): the ivory lines are drawn at 55 % opacity and
 * always sit under a petróleo overlay of at least 80 % (95 % on the left, behind the text;
 * 90 % across phones, where the text spans the full width),
 * so the text keeps WCAG AA (≥ 4.5:1) everywhere and reaches AAA (≥ 7:1).
 * e2e/contrast.spec.ts measures it on the rendered pixels in the six canonical viewports.
 */
function HeroBackdrop() {
  return (
    <>
      <svg
        viewBox="0 0 1440 640"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 -z-20 size-full"
      >
        <g
          stroke="currentColor"
          strokeWidth={1.25}
          strokeOpacity={0.55}
          strokeLinejoin="round"
          className="text-marfil"
        >
          <path d="M0 430 120 380l90 25 120-85 90 40 120-70 110 50 110-70 120 60 110-80 110 60 110-70 120 60 110-40" />
          <path d="M0 500 150 440l110 30 130-80 110 60 120-50 120 55 120-75 120 60 130-70 130 60 100-40 100 30" />
          <path d="M960 150c20-80 160-110 280-90s180 90 140 150-200 70-300 40c-90-25-130-50-120-100Z" />
          <path d="M1020 150c15-55 110-75 200-60s130 60 100 100-140 45-210 25c-60-17-100-30-90-65Z" />
          <path d="M1085 150c10-30 65-42 120-34s75 34 57 56-82 24-122 14c-35-9-62-16-55-36Z" />
        </g>
        <path
          d="M0 580 180 520l120 30 150-70 130 60 140-40 140 60 140-70 150 55 150-45 140 30"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          className="text-ocre"
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-petroleo/95 via-petroleo/90 to-petroleo/90 md:via-petroleo/85 md:to-petroleo/80"
      />
    </>
  );
}

/**
 * Home page body, shared by `/` and `/en/`: hero with the brand promise, the five discipline
 * cards (anchors for the header menu), the brand banner and the Mexican-brands section.
 *
 * @param locale - Language of the page; picks the dictionary and the localized links.
 */
export function HomeView({ locale }: Readonly<{ locale: Locale }>) {
  const messages = getMessages(locale);
  const { hero, mexicanTalent } = messages.home;
  return (
    <>
      <section
        data-hero
        className="relative isolate overflow-hidden bg-petroleo text-marfil"
      >
        <HeroBackdrop />
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
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-marfil px-6 py-3 font-semibold text-petroleo"
              >
                <Compass aria-hidden="true" size={20} />
                {hero.primaryCta}
              </a>
              <a
                href={routeFor('about', locale)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-marfil/60 px-6 py-3 font-semibold"
              >
                {hero.secondaryCta}
                <ArrowRight aria-hidden="true" size={20} />
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
