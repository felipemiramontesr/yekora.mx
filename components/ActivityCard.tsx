import type { Discipline, Messages } from '@/app/i18n';

interface ActivityCardProps {
  discipline: Discipline;
  name: string;
  levelLabel: string;
  activity: Messages['activities']['items'][Discipline];
}

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
