import type { ReactNode } from 'react';
import { SiteShell } from '@/components/views/SiteShell';
import { siteMetadata } from '@/lib/routes';

export const metadata = siteMetadata('es-MX');

export default function Layout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <SiteShell locale="es-MX">{children}</SiteShell>;
}
