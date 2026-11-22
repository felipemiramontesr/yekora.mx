/**
 * The `?lang=` query parameter shared by every route that answers in one language (FC 027 Q03):
 * one schema, so the routes and the API contract (apps/api/src/contract.ts) cannot drift apart.
 *
 * @module
 */
import { z } from 'zod';

/** Language of the answer; Spanish (Mexico) when absent. */
export const languageSchema = z.enum(['es-MX', 'en']).default('es-MX');

/** The two official languages (FC 067 T1.2). */
const SUPPORTED: readonly unknown[] = ['es-MX', 'en'];

/**
 * Whether a request body names a language outside the catalog under `key` (FC 067 T1.2: the
 * route answers 400 LOCALE_INPUT_UNSUPPORTED). A body without the key, or one that is not an
 * object, names none, so it is not refused here: the schema of the route decides the rest.
 *
 * @param body - The parsed body, whatever it is.
 * @param key - The field that carries the language.
 * @returns True when the field is present and is neither `es-MX` nor `en`.
 */
export function unsupportedLocale(body: unknown, key: string): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const value = (body as Record<string, unknown>)[key];
  return value !== undefined && !SUPPORTED.includes(value);
}

/** Query of a route whose only parameter is the language. */
export const languageQuery = z.object({ lang: languageSchema });
