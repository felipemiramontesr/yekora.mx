import type { NextConfig } from 'next';

// Static export served from Hostinger public_html (FC 003): no Node runtime in production.
// trailingSlash makes every page a folder with index.html, which the web server resolves natively.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // FC 004: with two root layouts no layout can wrap a 404, so app/global-not-found.tsx renders
  // its own document and the export writes it to out/404.html.
  experimental: { globalNotFound: true },
};
export default nextConfig;
