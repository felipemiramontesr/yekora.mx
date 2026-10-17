import type { MetadataRoute } from 'next';
import { getMessages } from '@/app/i18n';

/** Required by the static export: the manifest is rendered once, at build time. */
export const dynamic = 'force-static';

/**
 * Web App Manifest (FC 007): makes YĒKORA installable, with brand colors and the icons derived
 * from the isotype. Spanish is the manifest language, as at the site root.
 *
 * @returns The manifest Next.js serializes to `/manifest.webmanifest`.
 */
export default function manifest(): MetadataRoute.Manifest {
  const { meta } = getMessages('es-MX');
  return {
    name: meta.title,
    short_name: 'YĒKORA',
    description: meta.description,
    lang: 'es-MX',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#213C41',
    background_color: '#F8F5EE',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
