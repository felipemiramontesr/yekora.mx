import type { Messages } from '@/app/i18n';
import type { StaffFailure } from '@/lib/api/staffClient';

/** `account.users` texts. */
export type UsersTexts = Messages['account']['users'];

/** What a tab says after an action: a confirmation or the refusal. */
export type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
export const FIELD =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/**
 * The message of a refusal: the panel names each code; anything else is generic.
 *
 * @param texts - `account.users` texts.
 * @param reason - Why the request failed.
 * @returns The text to show.
 */
export function failureText(texts: UsersTexts, reason: StaffFailure): string {
  return reason in texts.errors
    ? texts.errors[reason as keyof UsersTexts['errors']]
    : texts.errors.unknown;
}
