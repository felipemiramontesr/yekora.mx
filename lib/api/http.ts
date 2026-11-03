/**
 * Transport shared by the browser clients of the API (FC 012, FC 028): one request with a
 * timeout, where being offline, a timeout or a network error become a typed reason instead of a
 * rejection, so no client ever throws.
 *
 * @module
 */

/** The API. E2E tests intercept it; they never reach production. */
export const API_URL = 'https://apiv1.yekora.mx';

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
