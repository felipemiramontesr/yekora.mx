import type { Metadata } from 'next';
import {
  defaultLocale,
  getMessages,
  type Locale,
  type Messages,
} from '@/app/i18n';

// Spanish lives at the root, English under /en/ with translated slugs (FC 003, Amendment 1).
// Every route ends in `/`: the static export writes each page as a folder with index.html.
const ROUTE_MAP = {
  home: { 'es-MX': '/', en: '/en/' },
  about: { 'es-MX': '/nosotros/', en: '/en/about/' },
  privacy: { 'es-MX': '/privacidad/', en: '/en/privacy/' },
  cookies: { 'es-MX': '/cookies/', en: '/en/cookies/' },
  terms: { 'es-MX': '/terminos/', en: '/en/terms/' },
} as const satisfies Record<string, Record<Locale, string>>;

export type Page = keyof typeof ROUTE_MAP;

export function routeFor(page: Page, locale: Locale): string {
  return ROUTE_MAP[page][locale];
}

// Which page a path belongs to, in either language, so the switcher can open its translation.
export function pageFromPath(pathname: string): Page {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const match = (Object.keys(ROUTE_MAP) as Page[]).find((page) =>
    Object.values(ROUTE_MAP[page]).includes(path as never)
  );
  return match ?? 'home';
}

function pageTitle(messages: Messages, page: Page): string {
  if (page === 'home') return messages.meta.title;
  if (page === 'about') return messages.about.metaTitle;
  return messages.legal[page].metaTitle;
}

// Site-wide metadata of a root layout: base URL for absolute links, default title and description.
export function siteMetadata(locale: Locale): Metadata {
  const { meta } = getMessages(locale);
  return {
    metadataBase: new URL('https://yekora.mx'),
    title: meta.title,
    description: meta.description,
  };
}

// A page's metadata: localized title, canonical in its own language and the hreflang pair.
export function pageMetadata(page: Page, locale: Locale): Metadata {
  return {
    title: pageTitle(getMessages(locale), page),
    alternates: {
      canonical: routeFor(page, locale),
      languages: {
        'es-MX': routeFor(page, 'es-MX'),
        en: routeFor(page, 'en'),
        'x-default': routeFor(page, defaultLocale),
      },
    },
  };
}
