import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { CookieBanner } from '@/components/CookieBanner';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { getMessages, locales } from '../i18n';
import '../globals.css';
import { resolveLocale, type LocaleParams } from './locale';

// Self-hosted at build time by next/font: the browser never calls Google Fonts.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-inter',
});

// Only es-MX and en are generated; any other locale segment is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LocaleParams): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { meta } = getMessages(locale);
  return {
    metadataBase: new URL('https://yekora.mx'),
    title: meta.title,
    description: meta.description,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<LocaleParams & { children: ReactNode }>) {
  const locale = await resolveLocale(params);
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
