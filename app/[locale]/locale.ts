import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMessages, isLocale, type Locale, type Messages } from '../i18n';

export interface LocaleParams {
  params: Promise<{ locale: string }>;
}

// Route segments arrive as plain strings: anything outside the supported list is a 404.
export async function resolveLocale(
  params: LocaleParams['params']
): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}

const PAGE_PATHS = {
  home: '',
  about: '/nosotros',
  privacy: '/privacidad',
  cookies: '/cookies',
  terms: '/terminos',
} as const;
type Page = keyof typeof PAGE_PATHS;

function pageTitle(messages: Messages, page: Page): string {
  if (page === 'home') return messages.meta.title;
  if (page === 'about') return messages.about.metaTitle;
  return messages.legal[page].metaTitle;
}

// Builds a page's generateMetadata: localized title, and canonical + hreflang for its own path.
export function pageMetadata(page: Page) {
  const path = PAGE_PATHS[page];
  return async ({ params }: LocaleParams): Promise<Metadata> => {
    const locale = await resolveLocale(params);
    return {
      title: pageTitle(getMessages(locale), page),
      alternates: {
        canonical: `/${locale}${path}`,
        languages: {
          'es-MX': `/es-MX${path}`,
          en: `/en${path}`,
          'x-default': `/es-MX${path}`,
        },
      },
    };
  };
}
