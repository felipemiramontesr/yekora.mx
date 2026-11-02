import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { getMessages, type Locale } from '@/app/i18n';
import '@/app/globals.css';
import { CookieBanner } from '../CookieBanner';
import { Footer } from '../Footer';
import { Header } from '../Header';

// FC 035 (259_AN): Inter lives in the repository (SIL OFL, fonts/LICENSE-OFL.txt), so neither the
// build nor the browser calls Google. The files are the very ones Google served before: variable
// fonts, one per character range, declared at 400 and 600 only, as before, so text renders the
// same (a 500 request still resolves to the 400 face).
// Basic Latin, preloaded: almost every page needs only this file.
const inter = localFont({
  src: [
    { path: './fonts/inter-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-inter',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
  // The fallback face comes after the extended range below, or it would catch the Ē of YĒKORA.
  adjustFontFallback: false,
});
// Latin Extended (the Ē of YĒKORA): downloaded only when a page uses one of its characters.
const interExtended = localFont({
  src: [
    { path: './fonts/inter-latin-ext.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-ext.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-inter-ext',
  preload: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
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
    <html
      lang={locale}
      className={`${inter.variable} ${interExtended.variable}`}
    >
      <body className="min-h-screen bg-marfil font-sans text-petroleo antialiased">
        <Header locale={locale} messages={messages} />
        <main>{children}</main>
        <Footer locale={locale} messages={messages} />
        <CookieBanner locale={locale} messages={messages.cookieBanner} />
      </body>
    </html>
  );
}
