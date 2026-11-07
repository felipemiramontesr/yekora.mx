import { describe, expect, it, vi } from 'vitest';
import { dispatchDeploy } from './publish';

describe('dispatchDeploy (FC 029 T2.5)', () => {
  it('asks GitHub to run deploy.yml on main with the fine-grained token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 })
    );
    await expect(dispatchDeploy('github_pat_x', fetchImpl)).resolves.toBe(
      'CAT_PUBLISH_REQUESTED'
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/felipemiramontesr/yekora.mx/actions/workflows/deploy.yml/dispatches'
    );
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"ref":"main"}');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer github_pat_x',
      Accept: 'application/vnd.github+json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403, 404, 422, 500])(
    'names a %i answer CAT_PUBLISH_FAILED',
    async (status) => {
      await expect(
        dispatchDeploy(
          'github_pat_x',
          async () => new Response('{}', { status })
        )
      ).resolves.toBe('CAT_PUBLISH_FAILED');
    }
  );

  it('names a network error or a timeout CAT_PUBLISH_FAILED', async () => {
    await expect(
      dispatchDeploy('github_pat_x', async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toBe('CAT_PUBLISH_FAILED');
  });
});
