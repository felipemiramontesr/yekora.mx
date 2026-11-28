import Link from 'next/link';
import type { Discipline, Messages } from '@/app/i18n';
import { DisciplineIcon } from './icons/DisciplineIcon';

/** Props of {@link ActivityCard}. */
interface ActivityCardProps {
  /** Discipline slug; also the card's `id`, so header links like `/#escalada` land on it. */
  discipline: Discipline;
  /** Localized discipline name, the card's heading. */
  name: string;
  /** Localized description of the discipline. */
  activity: Messages['activities']['items'][Discipline];
  /** The catalog filtered by this discipline, in the page's language. */
  href: string;
}

/**
 * One discipline on the home page: its pictogram, name and what it involves. The whole card is a
 * link to the catalog filtered by it (FC 078, K-82), the same place the header and the footer
 * lead to. The pictogram is decorative; the link is read with all the text it shows. The `id`
 * stays, so `/#escalada` still lands on the card.
 */
export function ActivityCard({
  discipline,
  name,
  activity,
  href,
}: Readonly<ActivityCardProps>) {
  return (
    <Link
      id={discipline}
      href={href}
      className="flex scroll-mt-24 flex-col gap-3 rounded-xl border border-petroleo/15 bg-white/60 p-6 transition-shadow hover:border-petroleo hover:shadow-md focus-visible:ring-2 focus-visible:ring-petroleo"
    >
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-petroleo text-marfil">
        <DisciplineIcon discipline={discipline} size={30} />
      </span>
      <h3 className="text-xl font-semibold text-petroleo">{name}</h3>
      <p className="text-petroleo/80">{activity.description}</p>
    </Link>
  );
}
