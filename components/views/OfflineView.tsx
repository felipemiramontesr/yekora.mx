import { RefreshCw, WifiOff } from 'lucide-react';
import { getMessages, type Locale } from '@/app/i18n';

/**
 * Offline page body (FC 007), shared by `/offline/` and `/en/offline/`.
 *
 * The service worker precaches both pages and serves the matching one when a navigation fails
 * with no network and no cached copy. The page is served at the URL the visitor asked for.
 *
 * The retry control is a GET form with no action, which re-requests the current URL natively,
 * not a scripted button. Offline, the page's JavaScript may not be in the cache, so a click
 * handler that relied on hydration would do nothing once the connection is back. The form works
 * with or without JS, and "retry" stays a real button: it is an action, not a link.
 *
 * @param locale - Language of the page; picks the dictionary.
 */
export function OfflineView({ locale }: Readonly<{ locale: Locale }>) {
  const { offline } = getMessages(locale);
  return (
    <section className="bg-petroleo text-marfil">
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-20">
        <WifiOff aria-hidden="true" size={56} className="text-ocre" />
        <p className="inline-block border-b-2 border-ocre pb-1 text-sm uppercase tracking-widest">
          {offline.eyebrow}
        </p>
        <h1 className="text-4xl font-semibold md:text-5xl">{offline.title}</h1>
        <p className="max-w-xl text-lg text-marfil/90">{offline.lede}</p>
        <form method="get">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-marfil px-6 py-3 font-semibold text-petroleo"
          >
            <RefreshCw aria-hidden="true" size={20} />
            {offline.retry}
          </button>
        </form>
      </div>
    </section>
  );
}
