import { describe, expect, it, vi } from 'vitest';
import {
  createBrand,
  listBrands,
  publishCatalog,
  updateBrand,
} from './catalogAdminClient';

const BRAND = {
  id: 1,
  slug: 'cumbre',
  name: 'Cumbre',
  website: null,
  isActive: true,
};

/** A fetch that answers once with `status` and `body`. */
const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );

describe('catalog console client (FC 029 F3)', () => {
  it('reads with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, [BRAND]);
    await expect(listBrands(fetchImpl)).resolves.toEqual({
      ok: true,
      data: [BRAND],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/catalog/brands');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('writes with a fresh Idempotency-Key each time (ADR 0014)', async () => {
    const fetchImpl = answering(201, BRAND);
    await createBrand({ slug: 'cumbre', name: 'Cumbre' }, fetchImpl);
    await updateBrand(1, { isActive: false }, answering(200, BRAND));
    await createBrand({ slug: 'cumbre', name: 'Cumbre' }, fetchImpl);
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: '{"slug":"cumbre","name":"Cumbre"}',
    });
  });

  it('sends a PATCH to the brand and a body-less POST to publish', async () => {
    const patch = answering(200, BRAND);
    await updateBrand(7, { name: 'X' }, patch);
    expect(patch.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/brands/7'
    );
    expect(patch.mock.calls[0][1]?.method).toBe('PATCH');
    const publish = answering(202, {
      code: 'CAT_PUBLISH_REQUESTED',
      workflow: 'deploy.yml',
      ref: 'main',
      requestedAt: '2026-11-07T19:30:00.000Z',
    });
    await expect(publishCatalog(publish)).resolves.toMatchObject({ ok: true });
    expect(publish.mock.calls[0][1]?.body).toBeUndefined();
    expect(publish.mock.calls[0][1]?.headers).not.toHaveProperty(
      'Content-Type'
    );
  });

  it.each([
    [409, { detail: 'CAT_CONFLICT' }, 'CAT_CONFLICT'],
    [403, { detail: 'CAT_FORBIDDEN' }, 'CAT_FORBIDDEN'],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names a %i refusal by its code', async (status, body, reason) => {
    await expect(listBrands(answering(status, body))).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses an answer outside the contract, and reports a transport failure', async () => {
    await expect(listBrands(answering(200, [{ id: 'x' }]))).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(
      listBrands(async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listBrands();
    await createBrand({ slug: 'a', name: 'A' }).catch(() => undefined);
    await updateBrand(1, {}).catch(() => undefined);
    await publishCatalog().catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });
});
