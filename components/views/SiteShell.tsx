import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { getMessages, type Locale } from '@/app/i18n';
import '@/app/globals.css';
import { CookieBanner } from '../CookieBanner';
import { Footer } from '../Footer';
import { Header } from '../Header';

// Self-hosted at build time by next/font: the browser never calls Google Fonts.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-inter',
});

/** Props of {@link SiteShell}. */
interface SiteShellProps {
  /** Document language: sets `<html lang>` and the dictionary of header, footer and notice. */
  locale: Locale;
  /** Page content, rendered inside `<main>`. */
  children: ReactNode;
}

/**
 * The HTML document shared by both root layouts (`app/(es)` and `app/(en)/en`) and by the
 * branded 404: fonts, global styles, header, main, footer and cookie notice. Only the language
 * differs, which is why the layouts are one line each (ADR 0004).
 */
export function SiteShell({ locale, children }: Readonly<SiteShellProps>) {
  const messages = getMessages(locale);
  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen bg-marfil font-sans text-petroleo antialiased">
        <Header locale={locale} messages={messages} />
        <main>{children}</main>
        <Footer locale={locale} messages={messages} />
        <CookieBanner locale={locale} messages={messages.cookieBanner} />
      </body>
    </html>
  );
}
