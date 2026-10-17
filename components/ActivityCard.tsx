import type { Discipline, Messages } from '@/app/i18n';
import { DisciplineIcon } from './icons/DisciplineIcon';

/** Props of {@link ActivityCard}. */
interface ActivityCardProps {
  /** Discipline slug; also the card's `id`, so header links like `/#escalada` land on it. */
  discipline: Discipline;
  /** Localized discipline name, the card's heading. */
  name: string;
  /** Localized label shown before the level, e.g. "Nivel". */
  levelLabel: string;
  /** Localized level and description of the discipline. */
  activity: Messages['activities']['items'][Discipline];
}

/**
 * One discipline on the home page: its pictogram, name, level and what it involves.
 * The pictogram is decorative; the heading names the card.
 */
export function ActivityCard({
  discipline,
  name,
  levelLabel,
  activity,
}: Readonly<ActivityCardProps>) {
  return (
    <article
      id={discipline}
      className="flex scroll-mt-24 flex-col gap-3 rounded-xl border border-petroleo/15 bg-white/60 p-6"
    >
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-petroleo text-marfil">
        <DisciplineIcon discipline={discipline} size={30} />
      </span>
      <h3 className="text-xl font-semibold text-petroleo">{name}</h3>
      <p className="text-sm">
        <span className="font-semibold">{levelLabel}:</span>{' '}
        <span className="rounded-full border border-ocre px-2 py-0.5">
          {activity.level}
        </span>
      </p>
      <p className="text-petroleo/80">{activity.description}</p>
    </article>
  );
}
