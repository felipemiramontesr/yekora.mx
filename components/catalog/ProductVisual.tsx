import { Mountain } from 'lucide-react';
import { isDiscipline } from '@/app/i18n';
import { DisciplineIcon } from '../icons/DisciplineIcon';

/** Props of {@link ProductVisual}. */
interface ProductVisualProps {
  /** Product photo (site-local path under /images/products/), or null when it has none. */
  image: { path: string; alt: string } | null;
  /** Discipline slug: picks the pictogram shown when there is no photo. */
  discipline: string;
  /** `eager` for the first photo of a product page; cards below the fold load lazily. */
  loading?: 'eager' | 'lazy';
}

/**
 * Square product visual: the photo, or the discipline pictogram on petróleo when there is none
 * (a discipline added later in the database gets a generic mountain). The pictogram is
 * decorative because the product name is always next to it.
 */
export function ProductVisual({
  image,
  discipline,
  loading = 'lazy',
}: Readonly<ProductVisualProps>) {
  if (image) {
    return (
      <img
        src={image.path}
        alt={image.alt}
        width={800}
        height={800}
        loading={loading}
        className="aspect-square w-full rounded-lg object-cover"
      />
    );
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-petroleo text-marfil">
      {isDiscipline(discipline) ? (
        <DisciplineIcon discipline={discipline} size={72} />
      ) : (
        <Mountain aria-hidden="true" size={72} strokeWidth={1.5} />
      )}
    </div>
  );
}
