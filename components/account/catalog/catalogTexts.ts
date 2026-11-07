import type { Messages } from '@/app/i18n';
import type { CatalogFailure } from '@/lib/api/catalogAdminClient';

/** `account.catalog` texts. */
export type CatalogTexts = Messages['account']['catalog'];

/**
 * The message of a refusal: the console names each catalog code; anything else is generic.
 *
 * @param texts - `account.catalog` texts.
 * @param reason - Why the API gave no answer.
 * @returns The sentence to show.
 */
export function catalogFailureText(
  texts: CatalogTexts,
  reason: CatalogFailure
): string {
  return reason in texts.errors
    ? texts.errors[reason as keyof CatalogTexts['errors']]
    : texts.errors.unknown;
}
