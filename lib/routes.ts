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
  // Offline fallback served by the service worker (FC 007); noindex, never linked.
  offline: { 'es-MX': '/offline/', en: '/en/offline/' },
  // Catalog (FC 008); each product lives one level below, under the same slug in both languages.
  catalog: { 'es-MX': '/catalogo/', en: '/en/catalog/' },
  // Guest cart (FC 009); noindex: its content lives in the visitor's browser.
  cart: { 'es-MX': '/carrito/', en: '/en/cart/' },
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
 * same page translated.
 *
 * @param path - URL path with its final slash ({@link translatePath} normalizes it).
 * @returns The matching page, or `home` for an unknown path.
 */
function pageFromPath(path: string): Page {
  const match = (Object.keys(ROUTE_MAP) as Page[]).find((page) =>
    Object.values(ROUTE_MAP[page]).includes(path as never)
  );
  return match ?? 'home';
}

/**
 * URL path of a product page. The slug is the same in both languages; only the catalog prefix
 * is translated.
 *
 * @param slug - Product slug.
 * @param locale - Which language.
 * @returns e.g. `/catalogo/arnes-alpino/` or `/en/catalog/arnes-alpino/`.
 */
export function productPath(slug: string, locale: Locale): string {
  return `${ROUTE_MAP.catalog[locale]}${slug}/`;
}

/**
 * The current page in another language, for the language switcher: a product page maps to the
 * same product, any other path to its page in the route map.
 *
 * @param pathname - Current URL path, with or without the final slash.
 * @param target - Language to switch to.
 * @returns Absolute path with trailing slash.
 */
export function translatePath(pathname: string, target: Locale): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  for (const prefix of Object.values(ROUTE_MAP.catalog)) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      return productPath(path.slice(prefix.length, -1), target);
    }
  }
  return routeFor(pageFromPath(path), target);
}

function pageTitle(messages: Messages, page: Page): string {
  if (page === 'home') return messages.meta.title;
  if (page === 'about') return messages.about.metaTitle;
  if (page === 'offline') return messages.offline.metaTitle;
  if (page === 'catalog') return messages.catalog.metaTitle;
  if (page === 'cart') return messages.cart.metaTitle;
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
  return localizedMetadata(
    pageTitle(getMessages(locale), page),
    (target) => routeFor(page, target),
    locale
  );
}

/**
 * A product page's metadata: the product name as title, its description, canonical and hreflang
 * to the same product in the other language.
 *
 * @param product - Name, description and slug of the product in this language.
 * @param locale - Language of this copy of the page.
 */
export function productMetadata(
  product: { slug: string; name: string; description: string },
  locale: Locale
): Metadata {
  return {
    ...localizedMetadata(
      `${product.name} | YĒKORA`,
      (target) => productPath(product.slug, target),
      locale
    ),
    description: product.description,
  };
}

function localizedMetadata(
  title: string,
  pathIn: (locale: Locale) => string,
  locale: Locale
): Metadata {
  return {
    title,
    alternates: {
      canonical: pathIn(locale),
      languages: {
        'es-MX': pathIn('es-MX'),
        en: pathIn('en'),
        'x-default': pathIn(defaultLocale),
      },
    },
  };
}
