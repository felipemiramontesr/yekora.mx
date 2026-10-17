/**
 * Site-wide 404 page (FC 004).
 *
 * The static export has two root layouts, `app/(es)` and `app/(en)/en`, so no single layout can
 * wrap a not-found page. Next.js renders this file as its own document instead
 * (`experimental.globalNotFound` in `next.config.ts`) and writes it to `out/404.html`, which
 * Apache serves for every unknown path (`ErrorDocument 404 /404.html` in `public/.htaccess`).
 *
 * One file answers every unknown URL, in either language, so the page speaks Spanish first
 * (the site's default locale) and repeats the message in English with its own `lang`.
 *
 * @module
 */
import type { Metadata } from 'next';
import { Compass } from 'lucide-react';
import { getMessages, type Locale } from '@/app/i18n';
import { SiteShell } from '@/components/views/SiteShell';
import { routeFor } from '@/lib/routes';

/** Spanish title for the browser tab; search engines must not index an error page. */
export const metadata: Metadata = {
  title: getMessages('es-MX').notFound.metaTitle,
  robots: { index: false, follow: true },
};

/**
 * The 404 message in one language: what happened and the way back to that language's home.
 *
 * @param locale - Language of the block; also sets its `lang` so screen readers switch voice.
 * @param primary - The first block carries the page's only `h1`; the translation uses `h2`.
 */
function NotFoundMessage({
  locale,
  primary,
}: Readonly<{ locale: Locale; primary: boolean }>) {
  const { notFound } = getMessages(locale);
  const Heading = primary ? 'h1' : 'h2';
  return (
    <div lang={locale}>
      <p className="inline-block border-b-2 border-ocre pb-1 text-sm uppercase tracking-widest">
        {notFound.eyebrow}
      </p>
      <Heading className="mt-6 text-4xl font-semibold md:text-5xl">
        {notFound.title}
      </Heading>
      <p className="mt-4 max-w-xl text-lg text-marfil/90">{notFound.lede}</p>
      <a
        href={routeFor('home', locale)}
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-md bg-marfil px-6 py-3 font-semibold text-petroleo"
      >
        <Compass aria-hidden="true" size={20} />
        {notFound.back}
      </a>
    </div>
  );
}

/**
 * Branded 404 document: the regular site shell (header, footer, cookie notice) in Spanish,
 * with the isotype and the bilingual "off the trail" message in between.
 */
export default function GlobalNotFound() {
  return (
    <SiteShell locale="es-MX">
      <section className="bg-petroleo text-marfil">
        <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 md:flex-row md:items-center">
          {/* Client isotype, decorative: the heading below carries the message. */}
          <img
            src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"
            alt=""
            width={110}
            height={126}
            className="shrink-0"
          />
          <div className="flex flex-col gap-14">
            <NotFoundMessage locale="es-MX" primary />
            <NotFoundMessage locale="en" primary={false} />
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
