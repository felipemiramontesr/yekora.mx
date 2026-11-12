/**
 * Pieces the panels of the catalog console share (FC 029 F3): the look of a text field, the note
 * a panel shows after an action, and the reading of a form field.
 *
 * @module
 */

/** What a panel says after an action: a confirmation or the refusal. */
export type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
export const FIELD =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/**
 * A form field as trimmed text; a file or a missing field reads as empty.
 *
 * @param data - The submitted form.
 * @param name - The field's name.
 * @returns The trimmed text.
 */
export function textOf(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}
