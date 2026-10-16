import { NextResponse, type NextRequest } from 'next/server';
import { defaultLocale, isLocale, type Locale } from './app/i18n';

// Technical preference cookie, declared in /cookies. Remembers the last language visited.
export const LOCALE_COOKIE = 'yekora_locale';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Saved choice first, then the browser's first preferred language, then es-MX.
function preferredLocale(request: NextRequest): Locale {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  const firstTag = request.headers
    .get('accept-language')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  return firstTag?.startsWith('en') ? 'en' : defaultLocale;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const segment = pathname.split('/')[1];

  if (isLocale(segment)) {
    const response = NextResponse.next();
    if (request.cookies.get(LOCALE_COOKIE)?.value !== segment) {
      response.cookies.set(LOCALE_COOKIE, segment, {
        path: '/',
        maxAge: ONE_YEAR_SECONDS,
        sameSite: 'lax',
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
      });
    }
    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${preferredLocale(request)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Pages only: skip Next internals, API routes and any path with a file extension.
  // `[.]` matches a literal dot without escaping (Next.js reads this value statically).
  matcher: ['/((?!_next|api|.*[.].*).*)'],
};
