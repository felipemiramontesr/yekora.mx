/**
 * Publishing the catalog (FC 029 F2c, T2.5, 321_AN): the static store shows catalog changes
 * only once it is built again, so «Publicar cambios» asks GitHub to run deploy.yml on main
 * through `workflow_dispatch`. Ω chose the whole pipeline (option A): every publication passes
 * the same gates as a commit before the site is rebuilt and deployed.
 *
 * The token is fine-grained, limited to this repository and to `Actions: write`; it is never
 * logged and never leaves this call. GitHub answers 204 with no body when the run is queued.
 *
 * @module
 */

/** The workflow a publication runs, on the branch it runs from. */
const DISPATCH_URL =
  'https://api.github.com/repos/felipemiramontesr/yekora.mx/actions/workflows/deploy.yml/dispatches';

/** How long GitHub may take to queue the run. */
const TIMEOUT_MS = 10_000;

/** What happened to a dispatch. */
type DispatchOutcome = 'CAT_PUBLISH_REQUESTED' | 'CAT_PUBLISH_FAILED';

/**
 * Asks GitHub to run deploy.yml on main.
 *
 * @param token - The fine-grained token (`Actions: write`).
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns CAT_PUBLISH_REQUESTED when GitHub queued the run (204); CAT_PUBLISH_FAILED on any
 *   other answer, a timeout or a network error.
 */
export async function dispatchDeploy(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<DispatchOutcome> {
  try {
    const answer = await fetchImpl(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'yekora-api',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return answer.status === 204
      ? 'CAT_PUBLISH_REQUESTED'
      : 'CAT_PUBLISH_FAILED';
  } catch {
    return 'CAT_PUBLISH_FAILED';
  }
}
