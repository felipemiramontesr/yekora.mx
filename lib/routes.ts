/**
 * Route map and page metadata of the static site (FC 003, ADR 0002).
 *
 * Spanish lives at the root and English under /en/ with translated slugs. Every route ends in
 * `/`: the static export writes each page as a folder with index.html, which Apache serves as is.
 *
 * @module
 */
import type { Metadata } from 'next';
import {
  defaultLocale,
  getMessages,
  type Locale,
  type Messages,
} from '@/app/i18n';

const ROUTE_MAP = {
  home: { 'es-MX': '/', en: '/en/' },
  about: { 'es-MX': '/nosotros/', en: '/en/about/' },
  privacy: { 'es-MX': '/privacidad/', en: '/en/privacy/' },
  cookies: { 'es-MX': '/cookies/', en: '/en/cookies/' },
  terms: { 'es-MX': '/terminos/', en: '/en/terms/' },
  shipping: {
    'es-MX': '/envios-y-devoluciones/',
    en: '/en/shipping-and-returns/',
  },
} as const satisfies Record<string, Record<Locale, string>>;

/** A page that exists in every language (key of the route map). */
export type Page = keyof typeof ROUTE_MAP;

/**
 * URL path of a page in a language.
 *
 * @param page - Which page.
 * @param locale - Which language.
 * @returns Absolute path with trailing slash, e.g. `/en/about/`.
 */
export function routeFor(page: Page, locale: Locale): string {
  return ROUTE_MAP[page][locale];
}

/**
 * Which page a path belongs to, in either language, so the language switcher can open the
 * same page translated. Accepts paths with or without the final slash.
 *
 * @param pathname - Current URL path.
 * @returns The matching page, or `home` for an unknown path.
 */
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

/**
 * Site-wide metadata of a root layout: base URL for absolute links, default title and description.
 *
 * @param locale - Language of the layout.
 */
export function siteMetadata(locale: Locale): Metadata {
  const { meta } = getMessages(locale);
  return {
    metadataBase: new URL('https://yekora.mx'),
    title: meta.title,
    description: meta.description,
  };
}

/**
 * A page's metadata: localized title, canonical in its own language and the hreflang set,
 * with Spanish as `x-default`.
 *
 * @param page - Which page.
 * @param locale - Language of this copy of the page.
 */
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
