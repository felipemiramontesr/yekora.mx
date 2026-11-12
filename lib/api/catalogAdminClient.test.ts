import { describe, expect, it, vi } from 'vitest';
import {
  createBrand,
  createFacetGroup,
  createFacetValue,
  createProduct,
  listBrands,
  listFacets,
  listProducts,
  publishCatalog,
  updateBrand,
  updateFacetGroup,
  updateFacetValue,
  updateProduct,
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

describe('facet console client (FC 029 F3b)', () => {
  const VALUE = {
    id: 10,
    code: 'nailon',
    valueEs: 'Nailon',
    valueEn: 'Nylon',
    sortOrder: 0,
  };
  const GROUP = {
    id: 2,
    code: 'material',
    nameEs: 'Material',
    nameEn: 'Material',
    isRequired: false,
    isOrdered: false,
    isFilterable: true,
    showOnLanding: false,
    isSystem: false,
    isActive: true,
    sortOrder: 5,
    values: [VALUE],
  };

  it('reads every group with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, [GROUP]);
    await expect(listFacets(fetchImpl)).resolves.toEqual({
      ok: true,
      data: [GROUP],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/catalog/facets');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('sends each write to its route, under a fresh Idempotency-Key', async () => {
    const group = answering(201, GROUP);
    await createFacetGroup(
      { code: 'material', nameEs: 'Material', nameEn: 'Material' },
      group
    );
    await updateFacetGroup(2, { isActive: false }, answering(200, GROUP));
    const value = answering(201, VALUE);
    await createFacetValue(
      2,
      { code: 'nailon', valueEs: 'Nailon', valueEn: 'Nylon' },
      value
    );
    const relabel = answering(200, VALUE);
    await updateFacetValue(10, { valueEn: 'Nylon 6' }, relabel);
    expect(group.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/facet-groups'
    );
    expect(group.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(value.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/facet-groups/2/values'
    );
    expect(relabel.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/facet-values/10'
    );
    expect(relabel.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: '{"valueEn":"Nylon 6"}',
    });
    for (const call of [group, value, relabel]) {
      const key = (call.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('names the refusal of the system group', async () => {
    await expect(
      updateFacetGroup(
        1,
        { isActive: false },
        answering(409, { detail: 'CAT_SYSTEM_GROUP_LOCKED' })
      )
    ).resolves.toEqual({ ok: false, reason: 'CAT_SYSTEM_GROUP_LOCKED' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await listFacets();
    await createFacetGroup({ code: 'a', nameEs: 'A', nameEn: 'A' }).catch(
      () => undefined
    );
    await updateFacetGroup(1, {}).catch(() => undefined);
    await createFacetValue(1, { code: 'a', valueEs: 'A', valueEn: 'A' }).catch(
      () => undefined
    );
    await updateFacetValue(1, {}).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(5);
    spy.mockRestore();
  });
});

describe('product console client (FC 029 F3c)', () => {
  const PRODUCT = {
    id: 7,
    sku: 'TRAIL-1',
    slug: 'tenis-trail',
    nameEs: 'Tenis trail',
    nameEn: 'Trail shoes',
    descriptionEs: '',
    descriptionEn: '',
    priceMxnCents: 485000,
    stock: 10,
    reservedStock: 0,
    discipline: 'trail-running',
    level: 'intermedio',
    brandId: null,
    shippingClass: 'estandar',
    weightGrams: 800,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 120,
    isActive: true,
    isTest: false,
    facetValueIds: [],
    gallery: [],
  };

  it('reads a page of products by its number, with the session cookie', async () => {
    const page = { items: [PRODUCT], total: 1, page: 2, pageSize: 50 };
    const fetchImpl = answering(200, page);
    await expect(listProducts(2, fetchImpl)).resolves.toEqual({
      ok: true,
      data: page,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/products?page=2'
    );
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('creates and edits under a fresh Idempotency-Key, and names the new refusals', async () => {
    const create = answering(201, PRODUCT);
    await createProduct(
      {
        sku: 'TRAIL-1',
        slug: 'tenis-trail',
        nameEs: 'Tenis trail',
        nameEn: 'Trail shoes',
        descriptionEs: '',
        descriptionEn: '',
        priceMxnCents: 485000,
        stock: 10,
        discipline: 'trail-running',
        level: 'intermedio',
        shippingClass: 'estandar',
        weightGrams: 800,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 120,
      },
      create
    );
    const edit = answering(200, PRODUCT);
    await updateProduct(7, { isActive: false }, edit);
    expect(create.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/products'
    );
    expect(create.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(edit.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/catalog/products/7'
    );
    expect(edit.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: '{"isActive":false}',
    });
    for (const call of [create, edit]) {
      const key = (call.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
    }
    await expect(
      updateProduct(7, {}, answering(422, { detail: 'CAT_REFERENCE_INVALID' }))
    ).resolves.toEqual({ ok: false, reason: 'CAT_REFERENCE_INVALID' });
    await expect(
      updateProduct(
        7,
        {},
        answering(409, { detail: 'CAT_STOCK_BELOW_RESERVED' })
      )
    ).resolves.toEqual({ ok: false, reason: 'CAT_STOCK_BELOW_RESERVED' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await listProducts();
    await createProduct({} as never).catch(() => undefined);
    await updateProduct(1, {}).catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toContain('/products?page=1');
    spy.mockRestore();
  });
});
