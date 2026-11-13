/**
 * Transport shared by the browser clients of the API (FC 012, FC 028): one request with a
 * timeout, where being offline, a timeout or a network error become a typed reason instead of a
 * rejection, so no client ever throws.
 *
 * @module
 */
import type { z } from 'zod';

/** The production API. */
const PRODUCTION_API = 'https://apiv1.yekora.mx';

/**
 * The API. E2E tests intercept it; they never reach production. For local work only,
 * `NEXT_PUBLIC_API_URL=http://localhost:3001` in `.env.local` points a development server at the API
 * running on this machine; anything that is not a `http://localhost:` address is ignored, so a
 * build can never be pointed anywhere else by mistake.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL?.startsWith(
  'http://localhost:'
)
  ? process.env.NEXT_PUBLIC_API_URL
  : PRODUCTION_API;

/** Why a request did not give an answer within the contract. */
export type TransportFailure = 'offline' | 'timeout' | 'server' | 'invalid';

/**
 * Sends one request with a timeout.
 *
 * @param fetchImpl - The fetch to use (injectable for tests).
 * @param url - Absolute URL.
 * @param init - Request options.
 * @param timeoutMs - Budget before aborting.
 * @returns The response, or `offline` / `timeout` when there was none.
 */
export async function call(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | 'offline' | 'timeout'> {
  if (globalThis.navigator?.onLine === false) return 'offline';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const answer = await fetchImpl(url, {
    ...init,
    signal: controller.signal,
  }).catch((): 'offline' | 'timeout' =>
    controller.signal.aborted ? 'timeout' : 'offline'
  );
  clearTimeout(timer);
  return answer;
}

/**
 * Body of an answer as JSON.
 *
 * @param answer - The response.
 * @returns The parsed body, or undefined when it is not JSON.
 */
export function json(answer: Response): Promise<unknown> {
  return answer.json().catch(() => undefined);
}

/** A JSON answer within its contract, or why there is none. */
type ApiResult<T, R> =
  { ok: true; data: T } | { ok: false; reason: R | TransportFailure };

/**
 * Sends one request with the session cookie (FC 028 account, FC 029 catalog console) and reads
 * its JSON answer against its schema: a refusal becomes the reason `refusal` names, an answer
 * outside the contract `invalid`, a missing one the transport failure.
 *
 * @param fetchImpl - The fetch to use (injectable for tests).
 * @param path - Path on the API, e.g. `/v1/account/me`.
 * @param init - Method, headers and the JSON body or the raw bytes, if any.
 * @param timeoutMs - Budget before aborting.
 * @param schema - The contract of a 2xx answer.
 * @param refusal - The reason of a non-2xx answer, from its status and body.
 * @returns The parsed answer, or why there is none.
 */
export async function sessionRequest<T, R>(
  fetchImpl: typeof fetch,
  path: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: object;
    /** Raw bytes sent as they are (an image upload), instead of a JSON body. */
    raw?: Blob;
  },
  timeoutMs: number,
  schema: z.ZodType<T>,
  refusal: (status: number, body: unknown) => R
): Promise<ApiResult<T, R>> {
  const answer = await call(
    fetchImpl,
    `${API_URL}${path}`,
    {
      method: init.method,
      credentials: 'include',
      headers: init.headers,
      body: init.raw ?? (init.body && JSON.stringify(init.body)),
    },
    timeoutMs
  );
  if (typeof answer === 'string') return { ok: false, reason: answer };
  const payload = await json(answer);
  if (!answer.ok) return { ok: false, reason: refusal(answer.status, payload) };
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: 'invalid' };
}
