/**
 * The `?lang=` query parameter shared by every route that answers in one language (FC 027 Q03):
 * one schema, so the routes and the API contract (apps/api/src/contract.ts) cannot drift apart.
 *
 * @module
 */
import { z } from 'zod';

/** Language of the answer; Spanish (Mexico) when absent. */
export const languageSchema = z.enum(['es-MX', 'en']).default('es-MX');

/** Query of a route whose only parameter is the language. */
export const languageQuery = z.object({ lang: languageSchema });
