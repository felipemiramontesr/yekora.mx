'use client';

import { ClipboardList, Package, ShieldCheck, Tags, Truck } from 'lucide-react';
import type { ComponentType, MouseEvent } from 'react';
import type { Messages } from '@/app/i18n';
import { type AccountView, accountPath } from '@/lib/account/accountPaths';
import type { MeResponse } from '@/lib/account/authTypes';
import { type AdminCard, adminCardsOf } from '@/lib/account/sections';

/** The pictogram of each card. */
const ICONS: Record<AdminCard['key'], ComponentType<{ size: number }>> = {
  orders: ClipboardList,
  products: Package,
  catalog: Tags,
  shipping: Truck,
  users: ShieldCheck,
};

/** The view a card opens. */
function viewOf(card: AdminCard): AccountView {
  return { tab: card.tab, orderNumber: null, section: card.section };
}

/**
 * «Administración» (FC 052 T1.1, T2.4): one card for each console of the store the account may
 * open, and none for one it may not: «Pedidos» with `orders:read`, «Productos» and «Catálogo» with
 * `catalog:write`, «Usuarios, roles y permisos» with `sellers:manage`. It is a convenience only; the API refuses what
 * the account cannot do. Each card is a link to the console's own address, which the area routes
 * without reloading.
 *
 * @param user - The signed-in account, for the cards it may open.
 * @param area - Path of the account area in the page's language.
 * @param texts - `account.adminHub` texts.
 * @param onNavigate - Opens a view of the area.
 */
export function AccountAdminHub({
  user,
  area,
  texts,
  onNavigate,
}: Readonly<{
  user: Pick<MeResponse, 'roles' | 'permissions'>;
  area: string;
  texts: Messages['account']['adminHub'];
  onNavigate: (view: AccountView) => void;
}>) {
  const cards = adminCardsOf(user);
  return (
    <section aria-label={texts.title} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{texts.title}</h2>
        <p className="text-petroleo/80">{texts.intro}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = ICONS[card.key];
          const text = texts.cards[card.key];
          const href = accountPath(area, viewOf(card));
          return (
            <li key={card.key}>
              <a
                href={href}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onNavigate(viewOf(card));
                }}
                className="flex h-full flex-col gap-3 rounded-xl border border-petroleo/20 bg-white/60 p-5 hover:border-petroleo focus-visible:border-petroleo"
              >
                <span className="flex items-center gap-3 text-lg font-semibold">
                  <Icon size={28} />
                  {text.name}
                </span>
                <span className="text-petroleo/80">{text.description}</span>
                <span className="mt-auto text-sm font-semibold underline underline-offset-4">
                  {texts.open}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
