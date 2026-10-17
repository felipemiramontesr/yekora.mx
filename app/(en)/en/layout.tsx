import type { ReactNode } from 'react';
import { PwaRegister } from '@/components/PwaRegister';
import { SiteShell } from '@/components/views/SiteShell';
import { siteMetadata } from '@/lib/routes';

export const metadata = siteMetadata('en');

export default function Layout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SiteShell locale="en">
      <PwaRegister />
      {children}
    </SiteShell>
  );
}
