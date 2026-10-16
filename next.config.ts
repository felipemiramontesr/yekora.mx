import type { NextConfig } from 'next';

// Static export served from Hostinger public_html (FC 003): no Node runtime in production.
// trailingSlash makes every page a folder with index.html, which the web server resolves natively.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
