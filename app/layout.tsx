import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Protocol L',
  description: 'NO SIGNED FC = NO PRODUCT CODE',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
