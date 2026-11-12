// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { listOrders, me } from '@/lib/api/accountClient';
import {
  createBrand,
  createFacetGroup,
  createFacetValue,
  type AdminProduct,
  createProduct,
  listBrands,
  listFacets,
  listProducts,
  publishCatalog,
  updateBrand,
  updateFacetGroup,
  updateFacetValue,
  updateProduct,
} from '@/lib/api/catalogAdminClient';
import { AccountApp } from '../AccountApp';
import { CatalogConsole } from './CatalogConsole';

vi.mock('@/lib/api/accountClient', () => ({
  me: vi.fn(),
  logout: vi.fn(),
  forgetDevice: vi.fn(),
  listOrders: vi.fn(),
  readOrder: vi.fn(),
}));
vi.mock('@/lib/api/catalogAdminClient', () => ({
  listBrands: vi.fn(),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  listFacets: vi.fn(),
  createFacetGroup: vi.fn(),
  updateFacetGroup: vi.fn(),
  createFacetValue: vi.fn(),
  updateFacetValue: vi.fn(),
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  publishCatalog: vi.fn(),
}));

const api = {
  me: vi.mocked(me),
  listOrders: vi.mocked(listOrders),
  listBrands: vi.mocked(listBrands),
  createBrand: vi.mocked(createBrand),
  updateBrand: vi.mocked(updateBrand),
  listFacets: vi.mocked(listFacets),
  createFacetGroup: vi.mocked(createFacetGroup),
  updateFacetGroup: vi.mocked(updateFacetGroup),
  createFacetValue: vi.mocked(createFacetValue),
  updateFacetValue: vi.mocked(updateFacetValue),
  listProducts: vi.mocked(listProducts),
  createProduct: vi.mocked(createProduct),
  updateProduct: vi.mocked(updateProduct),
  publishCatalog: vi.mocked(publishCatalog),
};

const { account, checkout } = getMessages('es-MX');
const t = account.catalog;
const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const CUMBRE = {
  id: 1,
  slug: 'cumbre',
  name: 'Cumbre',
  website: 'https://cumbre.example',
  isActive: true,
};
const EDITOR = {
  id: 'f0000000-0000-4000-8000-000000000001',
  email: 'editor@example.test',
  fullName: 'Eva Catálogo',
  roles: ['staff_catalog'],
  permissions: ['account:self', 'catalog:write'],
};

const renderConsole = () => render(<CatalogConsole texts={t} locale="es-MX" />);
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  api.listBrands.mockResolvedValue(ok([CUMBRE]));
  api.listOrders.mockResolvedValue(
    ok({ items: [], total: 0, page: 1, pageSize: 20 }) as never
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('catalog tab of /cuenta (FC 029 F3)', () => {
  it('opens the console at /cuenta/catalogo/ for an account with catalog:write', async () => {
    globalThis.history.replaceState(null, '', '/cuenta/catalogo/');
    api.me.mockResolvedValue(ok(EDITOR));
    render(
      <AccountApp
        locale="es-MX"
        messages={account}
        methods={checkout.method.options}
      />
    );
    expect(
      (
        await screen.findByRole('link', { name: account.dashboard.catalog })
      ).getAttribute('aria-current')
    ).toBe('page');
    expect(await screen.findByText('Cumbre')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: account.dashboard.panel })
    ).toBeNull();
  });

  it('never offers the console without catalog:write, even at its path', async () => {
    globalThis.history.replaceState(null, '', '/cuenta/catalogo/');
    api.me.mockResolvedValue(ok({ ...EDITOR, permissions: ['account:self'] }));
    render(
      <AccountApp
        locale="es-MX"
        messages={account}
        methods={checkout.method.options}
      />
    );
    await screen.findByRole('link', { name: account.dashboard.orders });
    expect(
      screen.queryByRole('link', { name: account.dashboard.catalog })
    ).toBeNull();
    expect(api.listBrands).not.toHaveBeenCalled();
  });
});

describe('brands (FC 029 F3a)', () => {
  it('lists every brand with its status', async () => {
    api.listBrands.mockResolvedValue(
      ok([
        CUMBRE,
        { ...CUMBRE, id: 2, name: 'Vieja', isActive: false, website: null },
      ])
    );
    renderConsole();
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText(t.brands.active)).toBeTruthy();
    expect(within(rows[2]).getByText(t.brands.retired)).toBeTruthy();
    expect(within(rows[2]).getByText('—')).toBeTruthy();
  });

  it('says so when there are no brands, or when the list fails', async () => {
    api.listBrands.mockResolvedValueOnce(ok([]));
    renderConsole();
    expect(await screen.findByText(t.brands.empty)).toBeTruthy();
    cleanup();
    api.listBrands.mockResolvedValueOnce(no('SESSION_INVALID_OR_EXPIRED'));
    renderConsole();
    expect(
      await screen.findByText(t.errors.SESSION_INVALID_OR_EXPIRED)
    ).toBeTruthy();
  });

  it('creates a brand, with no website when the field is empty, and reloads the list', async () => {
    api.createBrand.mockResolvedValue(ok(CUMBRE));
    renderConsole();
    await screen.findByText('Cumbre');
    const form = screen
      .getByRole('heading', { name: t.brands.new })
      .closest('form') as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText(t.brands.name), {
      target: { value: ' Cumbre ' },
    });
    fireEvent.change(
      within(form).getByLabelText(t.brands.slug, { exact: false }),
      {
        target: { value: 'cumbre' },
      }
    );
    fireEvent.submit(form);
    expect(await screen.findByText(t.brands.created)).toBeTruthy();
    expect(api.createBrand).toHaveBeenCalledWith({
      slug: 'cumbre',
      name: 'Cumbre',
      website: null,
    });
    expect(api.listBrands).toHaveBeenCalledTimes(2);
    expect(
      (within(form).getByLabelText(t.brands.name) as HTMLInputElement).value
    ).toBe('');
  });

  it('names a refused creation and keeps what was typed', async () => {
    api.createBrand.mockResolvedValue(no('CAT_CONFLICT'));
    renderConsole();
    await screen.findByText('Cumbre');
    const form = screen
      .getByRole('heading', { name: t.brands.new })
      .closest('form') as HTMLFormElement;
    fireEvent.change(within(form).getByLabelText(t.brands.name), {
      target: { value: 'Cumbre' },
    });
    fireEvent.submit(form);
    expect(await screen.findByText(t.errors.CAT_CONFLICT)).toBeTruthy();
    expect(
      (within(form).getByLabelText(t.brands.name) as HTMLInputElement).value
    ).toBe('Cumbre');
  });

  it('edits a brand’s name and website, or cancels', async () => {
    api.updateBrand.mockResolvedValue(ok(CUMBRE));
    renderConsole();
    await screen.findByText('Cumbre');
    press(t.brands.edit);
    press(t.brands.cancel);
    expect(screen.getByText('Cumbre')).toBeTruthy();
    press(t.brands.edit);
    const row = screen
      .getByDisplayValue('Cumbre')
      .closest('form') as HTMLFormElement;
    fireEvent.change(within(row).getByDisplayValue('https://cumbre.example'), {
      target: { value: '' },
    });
    fireEvent.submit(row);
    expect(await screen.findByText(t.brands.saved)).toBeTruthy();
    expect(api.updateBrand).toHaveBeenCalledWith(1, {
      name: 'Cumbre',
      website: null,
    });
  });

  it('opens the edit row of a brand without website with an empty field', async () => {
    api.listBrands.mockResolvedValue(ok([{ ...CUMBRE, website: null }]));
    renderConsole();
    await screen.findByText('Cumbre');
    press(t.brands.edit);
    const row = screen
      .getByDisplayValue('Cumbre')
      .closest('form') as HTMLFormElement;
    expect(
      (row.querySelector('input[name="website"]') as HTMLInputElement).value
    ).toBe('');
  });

  it('reads a missing field as empty, never as text of an object', async () => {
    api.updateBrand.mockResolvedValue(ok(CUMBRE));
    renderConsole();
    await screen.findByText('Cumbre');
    press(t.brands.edit);
    const row = screen
      .getByDisplayValue('Cumbre')
      .closest('form') as HTMLFormElement;
    row.querySelector('input[name="website"]')?.remove();
    fireEvent.submit(row);
    await waitFor(() =>
      expect(api.updateBrand).toHaveBeenCalledWith(1, {
        name: 'Cumbre',
        website: null,
      })
    );
  });

  it('retires an active brand and reactivates a retired one', async () => {
    api.updateBrand.mockResolvedValue(ok(CUMBRE));
    api.listBrands.mockResolvedValue(
      ok([CUMBRE, { ...CUMBRE, id: 2, name: 'Vieja', isActive: false }])
    );
    renderConsole();
    await screen.findByText('Vieja');
    press(t.brands.retire);
    await waitFor(() =>
      expect(api.updateBrand).toHaveBeenCalledWith(1, { isActive: false })
    );
    press(t.brands.reactivate);
    await waitFor(() =>
      expect(api.updateBrand).toHaveBeenCalledWith(2, { isActive: true })
    );
  });

  it('shows a generic message for a refusal it has no name for', async () => {
    api.updateBrand.mockResolvedValue(no('server'));
    renderConsole();
    await screen.findByText('Cumbre');
    press(t.brands.retire);
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
  });
});

describe('publish (FC 029 T2.5)', () => {
  it('asks for a publication and says when it was requested', async () => {
    api.publishCatalog.mockResolvedValue(
      ok({
        code: 'CAT_PUBLISH_REQUESTED',
        workflow: 'deploy.yml',
        ref: 'main',
        requestedAt: '2026-11-07T19:30:00.000Z',
      } as const)
    );
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.publish }));
    expect(screen.getByText(t.publish.explain)).toBeTruthy();
    press(t.publish.button);
    expect(
      await screen.findByText(/Pedimos la publicación a las/)
    ).toBeTruthy();
  });

  it('explains a refused publication', async () => {
    api.publishCatalog.mockResolvedValue(no('CAT_PUBLISH_UNAVAILABLE'));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.publish }));
    press(t.publish.button);
    expect(
      await screen.findByText(t.errors.CAT_PUBLISH_UNAVAILABLE)
    ).toBeTruthy();
  });
});

/** The system group Nivel (migration 006): its values mirror the experience levels. */
const NIVEL = {
  id: 1,
  code: 'nivel',
  nameEs: 'Nivel',
  nameEn: 'Level',
  isRequired: true,
  isOrdered: true,
  isFilterable: true,
  showOnLanding: true,
  isSystem: true,
  isActive: true,
  sortOrder: 0,
  values: [
    {
      id: 1,
      code: 'iniciacion',
      valueEs: 'Iniciación',
      valueEn: 'Beginner',
      sortOrder: 1,
    },
  ],
};
const MATERIAL = {
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
  values: [
    {
      id: 10,
      code: 'nailon',
      valueEs: 'Nailon',
      valueEn: 'Nylon',
      sortOrder: 0,
    },
  ],
};
const VACIA = {
  ...MATERIAL,
  id: 3,
  code: 'vacia',
  nameEs: 'Vacía',
  nameEn: 'Empty',
  isFilterable: false,
  isActive: false,
  values: [],
};

describe('facets (FC 029 F3b)', () => {
  const f = t.facets;
  const group = (name: string) => screen.getByRole('article', { name });
  const form = (name: string) => screen.getByRole('form', { name });
  const type = (scope: HTMLElement, label: string, value: string) =>
    fireEvent.change(within(scope).getByLabelText(label, { exact: false }), {
      target: { value },
    });

  async function openFacets(...groups: (typeof NIVEL)[]) {
    api.listFacets.mockResolvedValue(ok(groups));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.facets }));
    await screen.findByRole('form', { name: f.newGroup });
  }

  it('lists each group with its flags, status and values; the system group is read-only and cannot be retired', async () => {
    await openFacets(NIVEL, MATERIAL, VACIA);
    const nivel = group('Nivel');
    expect(within(nivel).getByText(f.system)).toBeTruthy();
    expect(
      within(nivel).getByText(
        `${f.flags.required} · ${f.flags.ordered} · ${f.flags.filterable} · ${f.flags.landing}`
      )
    ).toBeTruthy();
    expect(within(nivel).getByText('Iniciación')).toBeTruthy();
    expect(within(nivel).getByText(f.systemValues)).toBeTruthy();
    // T2.1b: it can be renamed, never retired, and its values are neither edited nor added.
    expect(
      within(nivel).getByRole('button', { name: `${f.edit}: Nivel` })
    ).toBeTruthy();
    expect(
      within(nivel).queryByRole('button', { name: new RegExp(f.retire) })
    ).toBeNull();
    expect(
      within(nivel).queryByRole('button', { name: `${f.edit}: Iniciación` })
    ).toBeNull();
    expect(
      screen.queryByRole('form', { name: `${f.newValue}: Nivel` })
    ).toBeNull();
    const material = group('Material');
    expect(within(material).queryByText(f.system)).toBeNull();
    expect(within(material).getByText(f.flags.filterable)).toBeTruthy();
    expect(
      within(material).getByRole('button', { name: `${f.retire}: Material` })
    ).toBeTruthy();
    const vacia = group('Vacía');
    expect(within(vacia).getByText(f.retired)).toBeTruthy();
    expect(within(vacia).getByText(f.noValues)).toBeTruthy();
    expect(
      within(vacia).getByRole('button', { name: `${f.reactivate}: Vacía` })
    ).toBeTruthy();
  });

  it('says so when there are no groups, or when the list fails', async () => {
    await openFacets();
    expect(screen.getByText(f.empty)).toBeTruthy();
    cleanup();
    api.listFacets.mockResolvedValueOnce(no('SESSION_INVALID_OR_EXPIRED'));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.facets }));
    expect(
      await screen.findByText(t.errors.SESSION_INVALID_OR_EXPIRED)
    ).toBeTruthy();
    expect(screen.getByText(t.loading)).toBeTruthy();
  });

  it('creates a group with its flags, reloads the list and clears the form', async () => {
    api.createFacetGroup.mockResolvedValue(ok(MATERIAL));
    await openFacets(NIVEL);
    const create = form(f.newGroup);
    type(create, f.code, 'peso');
    type(create, f.nameEs, ' Peso ');
    type(create, f.nameEn, 'Weight');
    fireEvent.click(within(create).getByLabelText(f.flags.landing));
    fireEvent.submit(create);
    expect(await screen.findByText(f.groupCreated)).toBeTruthy();
    expect(api.createFacetGroup).toHaveBeenCalledWith({
      code: 'peso',
      nameEs: 'Peso',
      nameEn: 'Weight',
      sortOrder: 0,
      isRequired: false,
      isOrdered: false,
      isFilterable: true,
      showOnLanding: true,
    });
    expect(api.listFacets).toHaveBeenCalledTimes(2);
    expect(
      (within(create).getByLabelText(f.nameEs) as HTMLInputElement).value
    ).toBe('');
    expect(
      (within(create).getByLabelText(f.flags.landing) as HTMLInputElement)
        .checked
    ).toBe(false);
  });

  it('names a refused creation and keeps what was typed', async () => {
    api.createFacetGroup.mockResolvedValue(no('CAT_CONFLICT'));
    await openFacets(NIVEL);
    const create = form(f.newGroup);
    type(create, f.code, 'nivel');
    type(create, f.nameEs, 'Otro');
    type(create, f.nameEn, 'Other');
    fireEvent.submit(create);
    expect(await screen.findByText(t.errors.CAT_CONFLICT)).toBeTruthy();
    expect(
      (within(create).getByLabelText(f.nameEs) as HTMLInputElement).value
    ).toBe('Otro');
  });

  it('edits a group’s names, order and flags, or cancels', async () => {
    api.updateFacetGroup.mockResolvedValue(ok(MATERIAL));
    await openFacets(NIVEL, MATERIAL);
    fireEvent.click(
      screen.getByRole('button', { name: `${f.edit}: Material` })
    );
    fireEvent.click(screen.getByRole('button', { name: f.cancel }));
    expect(
      screen.getByRole('button', { name: `${f.edit}: Material` })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: `${f.edit}: Material` })
    );
    const edit = form(`${f.edit}: Material`);
    type(edit, f.nameEs, 'Materiales');
    fireEvent.click(within(edit).getByLabelText(f.flags.filterable));
    fireEvent.click(within(edit).getByLabelText(f.flags.required));
    fireEvent.submit(edit);
    expect(await screen.findByText(f.saved)).toBeTruthy();
    expect(api.updateFacetGroup).toHaveBeenCalledWith(2, {
      nameEs: 'Materiales',
      nameEn: 'Material',
      sortOrder: 5,
      isRequired: true,
      isOrdered: false,
      isFilterable: false,
      showOnLanding: false,
    });
  });

  it('retires an active group and reactivates a retired one', async () => {
    api.updateFacetGroup.mockResolvedValue(ok(MATERIAL));
    await openFacets(MATERIAL, VACIA);
    fireEvent.click(
      screen.getByRole('button', { name: `${f.retire}: Material` })
    );
    await waitFor(() =>
      expect(api.updateFacetGroup).toHaveBeenCalledWith(2, { isActive: false })
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${f.reactivate}: Vacía` })
    );
    await waitFor(() =>
      expect(api.updateFacetGroup).toHaveBeenCalledWith(3, { isActive: true })
    );
  });

  it('adds a value to a group and clears the form, and keeps it when refused', async () => {
    api.createFacetValue.mockResolvedValue(ok(MATERIAL.values[0]));
    await openFacets(MATERIAL);
    const add = form(`${f.newValue}: Material`);
    type(add, f.code, 'poliester');
    type(add, f.valueEs, 'Poliéster');
    type(add, f.valueEn, 'Polyester');
    fireEvent.submit(add);
    expect(await screen.findByText(f.valueAdded)).toBeTruthy();
    expect(api.createFacetValue).toHaveBeenCalledWith(2, {
      code: 'poliester',
      valueEs: 'Poliéster',
      valueEn: 'Polyester',
      sortOrder: 0,
    });
    await waitFor(() =>
      expect(
        (within(add).getByLabelText(f.valueEs) as HTMLInputElement).value
      ).toBe('')
    );
    api.createFacetValue.mockResolvedValue(no('CAT_CONFLICT'));
    type(add, f.code, 'nailon');
    type(add, f.valueEs, 'Repetido');
    fireEvent.submit(add);
    expect(await screen.findByText(t.errors.CAT_CONFLICT)).toBeTruthy();
    expect(
      (within(add).getByLabelText(f.valueEs) as HTMLInputElement).value
    ).toBe('Repetido');
  });

  it('relabels a value, or cancels', async () => {
    api.updateFacetValue.mockResolvedValue(ok(MATERIAL.values[0]));
    await openFacets(MATERIAL);
    fireEvent.click(screen.getByRole('button', { name: `${f.edit}: Nailon` }));
    fireEvent.click(screen.getByRole('button', { name: f.cancel }));
    fireEvent.click(screen.getByRole('button', { name: `${f.edit}: Nailon` }));
    const edit = form(`${f.edit}: Nailon`);
    type(edit, f.valueEn, 'Nylon 6');
    fireEvent.submit(edit);
    expect(await screen.findByText(f.saved)).toBeTruthy();
    expect(api.updateFacetValue).toHaveBeenCalledWith(10, {
      valueEs: 'Nailon',
      valueEn: 'Nylon 6',
      sortOrder: 0,
    });
  });
});

/** The levels of the system group Nivel, as the product form offers them. */
const LEVELS = {
  ...NIVEL,
  values: [
    {
      id: 1,
      code: 'principiante',
      valueEs: 'Principiante',
      valueEn: 'Beginner',
      sortOrder: 1,
    },
    {
      id: 2,
      code: 'intermedio',
      valueEs: 'Intermedio',
      valueEn: 'Intermediate',
      sortOrder: 2,
    },
  ],
};
const OLD_BRAND = {
  ...CUMBRE,
  id: 2,
  slug: 'vieja',
  name: 'Vieja',
  isActive: false,
};
const TRAIL: AdminProduct = {
  id: 7,
  sku: 'TRAIL-1',
  slug: 'tenis-trail',
  nameEs: 'Tenis trail',
  nameEn: 'Trail shoes',
  descriptionEs: 'Para correr en montaña.',
  descriptionEn: 'For mountain running.',
  priceMxnCents: 485000,
  stock: 10,
  reservedStock: 2,
  discipline: 'trail-running',
  level: 'intermedio',
  brandId: 1,
  shippingClass: 'estandar',
  weightGrams: 800,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 120,
  isActive: true,
  isTest: false,
  facetValueIds: [10],
  gallery: [],
};
const OLD_TEST = {
  ...TRAIL,
  id: 8,
  sku: 'OLD-1',
  slug: 'viejo',
  nameEs: 'Viejo de prueba',
  reservedStock: 0,
  brandId: null,
  isActive: false,
  isTest: true,
  facetValueIds: [],
};
const pageOf = (items: AdminProduct[], total = items.length, page = 1) =>
  ok({ items, total, page, pageSize: 50 });

describe('products (FC 029 F3c)', () => {
  const p = t.products;
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label, { exact: false }), {
      target: { value },
    });

  async function openProducts(...items: AdminProduct[]) {
    api.listProducts.mockResolvedValue(pageOf(items));
    api.listBrands.mockResolvedValue(ok([CUMBRE, OLD_BRAND]));
    api.listFacets.mockResolvedValue(ok([LEVELS, MATERIAL, VACIA]));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.products }));
    await screen.findByRole('button', { name: p.new });
  }

  it('lists every product with its price, stock, reserved units and status', async () => {
    await openProducts(TRAIL, OLD_TEST);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('$4,850.00 MXN')).toBeTruthy();
    expect(within(rows[1]).getByText('10 · 2 apartadas')).toBeTruthy();
    expect(within(rows[1]).getByText(p.active)).toBeTruthy();
    expect(within(rows[2]).getByText('10')).toBeTruthy();
    expect(within(rows[2]).getByText(`${p.retired} · ${p.test}`)).toBeTruthy();
  });

  it('says so when there are no products, or when the list fails', async () => {
    await openProducts();
    expect(screen.getByText(p.empty)).toBeTruthy();
    cleanup();
    api.listProducts.mockResolvedValueOnce(no('SESSION_INVALID_OR_EXPIRED'));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.products }));
    expect(
      await screen.findByText(t.errors.SESSION_INVALID_OR_EXPIRED)
    ).toBeTruthy();
    expect(screen.getByText(t.loading)).toBeTruthy();
  });

  it('pages through the list', async () => {
    api.listProducts.mockImplementation(async (page = 1) =>
      pageOf([TRAIL], 120, page)
    );
    api.listBrands.mockResolvedValue(ok([]));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.products }));
    expect(await screen.findByText('Página 1 de 3')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: p.previous }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: p.next }));
    expect(await screen.findByText('Página 2 de 3')).toBeTruthy();
    expect(api.listProducts).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: p.previous }));
    expect(await screen.findByText('Página 1 de 3')).toBeTruthy();
  });

  it('retires and reactivates a product, and names a refusal', async () => {
    api.updateProduct.mockResolvedValue(ok(TRAIL));
    await openProducts(TRAIL, OLD_TEST);
    fireEvent.click(
      screen.getByRole('button', { name: `${p.retire}: Tenis trail` })
    );
    expect(await screen.findByText(p.saved)).toBeTruthy();
    expect(api.updateProduct).toHaveBeenCalledWith(7, { isActive: false });
    expect(api.listProducts).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole('button', { name: `${p.reactivate}: Viejo de prueba` })
    );
    await waitFor(() =>
      expect(api.updateProduct).toHaveBeenCalledWith(8, { isActive: true })
    );
    api.updateProduct.mockResolvedValue(no('CAT_REFERENCE_INVALID'));
    fireEvent.click(
      screen.getByRole('button', { name: `${p.retire}: Tenis trail` })
    );
    expect(
      await screen.findByText(t.errors.CAT_REFERENCE_INVALID)
    ).toBeTruthy();
  });

  it('creates a product: pesos become cents, the level, brand and facets come from the lists', async () => {
    api.createProduct.mockResolvedValue(ok(TRAIL));
    await openProducts();
    fireEvent.click(screen.getByRole('button', { name: p.new }));
    await screen.findByRole('form', { name: p.titleNew });
    // The retired brand is not offered to a new product; the retired group has no facets.
    expect(screen.queryByRole('option', { name: 'Vieja' })).toBeNull();
    expect(screen.queryByText(`${p.facets}: Vacía`)).toBeNull();
    type(p.sku, 'TRAIL-1');
    type(p.slug, 'tenis-trail');
    type(p.nameEs, 'Tenis trail');
    type(p.nameEn, 'Trail shoes');
    type(p.descriptionEs, 'Para correr.');
    type(p.priceMxn, '4850.10');
    type(p.stockField, '10');
    type(p.discipline, 'trail-running');
    type(p.level, 'intermedio');
    type(p.brand, '1');
    type(p.shippingClass, 'estandar');
    type(p.weight, '800');
    type(p.length, '300');
    type(p.width, '200');
    type(p.height, '120');
    fireEvent.click(screen.getByLabelText('Nailon'));
    fireEvent.submit(screen.getByRole('form', { name: p.titleNew }));
    expect(await screen.findByText(p.created)).toBeTruthy();
    expect(api.createProduct).toHaveBeenCalledWith({
      sku: 'TRAIL-1',
      slug: 'tenis-trail',
      nameEs: 'Tenis trail',
      nameEn: 'Trail shoes',
      descriptionEs: 'Para correr.',
      descriptionEn: '',
      priceMxnCents: 485010,
      stock: 10,
      discipline: 'trail-running',
      level: 'intermedio',
      brandId: 1,
      shippingClass: 'estandar',
      weightGrams: 800,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 120,
      facetValueIds: [10],
    });
    expect(api.listProducts).toHaveBeenCalledTimes(2);
  });

  it('creates a product without a brand', async () => {
    api.createProduct.mockResolvedValue(ok(TRAIL));
    await openProducts();
    fireEvent.click(screen.getByRole('button', { name: p.new }));
    await screen.findByRole('form', { name: p.titleNew });
    for (const [label, value] of [
      [p.sku, 'X-1'],
      [p.slug, 'x-1'],
      [p.nameEs, 'X'],
      [p.nameEn, 'X'],
      [p.priceMxn, '10'],
      [p.discipline, 'escalada'],
      [p.level, 'principiante'],
      [p.shippingClass, 'estandar'],
      [p.weight, '1'],
      [p.length, '1'],
      [p.width, '1'],
      [p.height, '1'],
    ]) {
      type(label, value);
    }
    fireEvent.submit(screen.getByRole('form', { name: p.titleNew }));
    await screen.findByText(p.created);
    expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: null, facetValueIds: [], stock: 0 })
    );
  });

  it('opens a product for editing with its data, its reserved units and its retired brand', async () => {
    api.updateProduct.mockResolvedValue(ok(TRAIL));
    const retiredBrand = { ...TRAIL, brandId: 2 };
    await openProducts(retiredBrand);
    fireEvent.click(
      screen.getByRole('button', { name: `${p.edit}: Tenis trail` })
    );
    await screen.findByRole('form', { name: p.titleEdit });
    expect(
      screen.getByText(`${p.sku}: TRAIL-1 · ${p.slug}: tenis-trail`)
    ).toBeTruthy();
    expect(
      screen.getByText(/Apartadas por pedidos pendientes: 2/)
    ).toBeTruthy();
    expect(
      (screen.getByLabelText(p.priceMxn, { exact: false }) as HTMLInputElement)
        .value
    ).toBe('4850');
    expect(
      (screen.getByLabelText(p.level, { exact: false }) as HTMLSelectElement)
        .value
    ).toBe('intermedio');
    // A retired brand stays offered to the product that has it, so saving does not drop it.
    expect(
      (screen.getByLabelText(p.brand, { exact: false }) as HTMLSelectElement)
        .value
    ).toBe('2');
    expect((screen.getByLabelText('Nailon') as HTMLInputElement).checked).toBe(
      true
    );
    type(p.nameEs, 'Tenis trail 2');
    fireEvent.click(screen.getByLabelText('Nailon'));
    fireEvent.submit(screen.getByRole('form', { name: p.titleEdit }));
    expect(await screen.findByText(p.saved)).toBeTruthy();
    expect(api.updateProduct).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        nameEs: 'Tenis trail 2',
        priceMxnCents: 485000,
        brandId: 2,
        facetValueIds: [],
      })
    );
  });

  it('names a refused write and keeps the form', async () => {
    api.updateProduct.mockResolvedValue(no('CAT_STOCK_BELOW_RESERVED'));
    await openProducts(TRAIL);
    fireEvent.click(
      screen.getByRole('button', { name: `${p.edit}: Tenis trail` })
    );
    await screen.findByRole('form', { name: p.titleEdit });
    fireEvent.submit(screen.getByRole('form', { name: p.titleEdit }));
    expect(
      await screen.findByText(t.errors.CAT_STOCK_BELOW_RESERVED)
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: p.titleEdit })).toBeTruthy();
  });

  it('goes back to the list from the form, and says why the form could not load', async () => {
    await openProducts(TRAIL);
    fireEvent.click(screen.getByRole('button', { name: p.new }));
    await screen.findByRole('form', { name: p.titleNew });
    fireEvent.click(screen.getByRole('button', { name: p.back }));
    expect(await screen.findByRole('button', { name: p.new })).toBeTruthy();
    api.listBrands.mockResolvedValue(no('CAT_FORBIDDEN'));
    fireEvent.click(screen.getByRole('button', { name: p.new }));
    expect(await screen.findByText(t.errors.CAT_FORBIDDEN)).toBeTruthy();
    expect(screen.queryByRole('form', { name: p.titleNew })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: p.back }));
    api.listBrands.mockResolvedValue(ok([CUMBRE]));
    api.listFacets.mockResolvedValue(no('SESSION_INVALID_OR_EXPIRED'));
    fireEvent.click(await screen.findByRole('button', { name: p.new }));
    expect(
      await screen.findByText(t.errors.SESSION_INVALID_OR_EXPIRED)
    ).toBeTruthy();
  });
});
