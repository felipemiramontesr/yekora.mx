// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
  replaceGallery,
  updateBrand,
  updateFacetGroup,
  updateFacetValue,
  updateProduct,
  uploadMedia,
} from '@/lib/api/catalogAdminClient';
import { canvasBlob, drawSquare, openImage } from '@/lib/catalog/imageCrop';
import { AccountApp } from '../AccountApp';
import { CatalogConsole } from './CatalogConsole';

vi.mock('@/lib/api/accountClient', () => ({
  me: vi.fn(),
  logout: vi.fn(),
  forgetDevice: vi.fn(),
  listOrders: vi.fn(),
  readOrder: vi.fn(),
}));
vi.mock('@/lib/catalog/imageCrop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catalog/imageCrop')>()),
  openImage: vi.fn(),
  drawSquare: vi.fn(),
  canvasBlob: vi.fn(),
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
  replaceGallery: vi.fn(),
  uploadMedia: vi.fn(),
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
  replaceGallery: vi.mocked(replaceGallery),
  uploadMedia: vi.mocked(uploadMedia),
  openImage: vi.mocked(openImage),
  drawSquare: vi.mocked(drawSquare),
  canvasBlob: vi.mocked(canvasBlob),
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

/** jsdom has no <dialog> methods: showModal only has to open it, as the browser does. */
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = showModal;
});

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

describe('product gallery (FC 029 F3d)', () => {
  const g = t.media;
  const SHA_A = 'a'.repeat(64);
  const SHA_B = 'b'.repeat(64);
  const SHA_NEW = 'c'.repeat(64);
  const WITH_PHOTOS: AdminProduct = {
    ...TRAIL,
    gallery: [
      {
        sha256: SHA_A,
        altEs: 'Frente',
        altEn: null,
        sortOrder: 0,
        isPrimary: true,
      },
      {
        sha256: SHA_B,
        altEs: null,
        altEn: 'Side',
        sortOrder: 1,
        isPrimary: false,
      },
    ],
  };
  const BITMAP = { width: 2000, height: 1000 } as ImageBitmap;
  const PHOTO = new File(['x'], 'foto.png', { type: 'image/png' });
  const srcs = () =>
    [...document.querySelectorAll('ol img')].map((image) =>
      image.getAttribute('src')
    );

  async function openGallery(product: AdminProduct) {
    api.listProducts.mockResolvedValue(pageOf([product]));
    renderConsole();
    fireEvent.click(screen.getByRole('tab', { name: t.sections.products }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: `${t.products.gallery}: ${product.nameEs}`,
      })
    );
    await screen.findByRole('heading', {
      name: `Galería de ${product.nameEs}`,
    });
  }

  /** Opens the crop panel and chooses a photo the browser decodes. */
  async function choosePhoto() {
    api.openImage.mockResolvedValue(BITMAP);
    fireEvent.click(screen.getByRole('button', { name: g.addPhoto }));
    const input = screen.getByLabelText(g.choose) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [PHOTO] } });
    await screen.findByText(g.preview);
  }

  it('shows the photos in order, the first one primary, with their alt texts', async () => {
    await openGallery(WITH_PHOTOS);
    expect(srcs()).toEqual([
      `https://apiv1.yekora.mx/v1/media/${SHA_A}`,
      `https://apiv1.yekora.mx/v1/media/${SHA_B}`,
    ]);
    expect(screen.getAllByText(g.primary)).toHaveLength(1);
    const alts = screen.getAllByLabelText(g.altEs) as HTMLInputElement[];
    expect(alts.map((field) => field.value)).toEqual(['Frente', '']);
    const english = screen.getAllByLabelText(g.altEn) as HTMLInputElement[];
    expect(english.map((field) => field.value)).toEqual(['', 'Side']);
  });

  it('says so when the product has no photos, and goes back to the list', async () => {
    await openGallery(TRAIL);
    expect(screen.getByText(g.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: g.back }));
    expect(
      await screen.findByRole('button', { name: t.products.new })
    ).toBeTruthy();
  });

  it('moves and removes photos; the first cannot go up nor the last down', async () => {
    await openGallery(WITH_PHOTOS);
    const up = screen.getAllByRole('button', {
      name: g.moveUp,
    }) as HTMLButtonElement[];
    const down = screen.getAllByRole('button', {
      name: g.moveDown,
    }) as HTMLButtonElement[];
    expect(up[0].disabled).toBe(true);
    expect(down[1].disabled).toBe(true);
    fireEvent.click(down[0]);
    expect(srcs()[0]).toContain(SHA_B);
    fireEvent.click(screen.getAllByRole('button', { name: g.moveUp })[1]);
    expect(srcs()[0]).toContain(SHA_A);
    fireEvent.click(screen.getAllByRole('button', { name: g.remove })[0]);
    expect(srcs()).toEqual([`https://apiv1.yekora.mx/v1/media/${SHA_B}`]);
  });

  it('saves the gallery in order with the alt texts, empty ones as null, and returns to the list', async () => {
    api.replaceGallery.mockResolvedValue(ok(WITH_PHOTOS));
    await openGallery(WITH_PHOTOS);
    fireEvent.change(screen.getAllByLabelText(g.altEs)[1], {
      target: { value: ' Lateral ' },
    });
    fireEvent.change(screen.getAllByLabelText(g.altEn)[0], {
      target: { value: 'Front' },
    });
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    expect(await screen.findByText(g.saved)).toBeTruthy();
    expect(api.replaceGallery).toHaveBeenCalledWith(7, {
      images: [
        { sha256: SHA_A, altEs: 'Frente', altEn: 'Front' },
        { sha256: SHA_B, altEs: 'Lateral', altEn: 'Side' },
      ],
    });
    expect(
      await screen.findByRole('button', { name: t.products.new })
    ).toBeTruthy();
    expect(api.listProducts).toHaveBeenCalledTimes(2);
  });

  it('names a refused save and stays on the gallery', async () => {
    api.replaceGallery.mockResolvedValue(no('CAT_REFERENCE_INVALID'));
    await openGallery(WITH_PHOTOS);
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    expect(
      await screen.findByText(t.errors.CAT_REFERENCE_INVALID)
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Galería de Tenis trail' })
    ).toBeTruthy();
  });

  it('crops, resizes and uploads a photo, then adds it to the gallery', async () => {
    api.drawSquare.mockReturnValue(true);
    const blob = new Blob(['webp'], { type: 'image/webp' });
    api.canvasBlob.mockResolvedValue(blob);
    api.uploadMedia.mockResolvedValue(
      ok({
        code: 'MEDIA_ACCEPTED',
        created: true,
        sha256: SHA_NEW,
        mimeType: 'image/webp',
        width: 600,
        height: 600,
        sizeBytes: 4,
      } as const)
    );
    await openGallery(WITH_PHOTOS);
    await choosePhoto();
    // The preview follows the sliders and the chosen width reaches the upload canvas.
    fireEvent.change(screen.getByLabelText(g.zoom), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(g.horizontal), {
      target: { value: '0.25' },
    });
    fireEvent.change(screen.getByLabelText(g.vertical), {
      target: { value: '0.75' },
    });
    await waitFor(() =>
      expect(api.drawSquare).toHaveBeenLastCalledWith(
        expect.anything(),
        BITMAP,
        { zoom: 2, x: 0.25, y: 0.75 },
        240
      )
    );
    fireEvent.change(screen.getByLabelText(g.size), {
      target: { value: '600' },
    });
    fireEvent.click(screen.getByRole('button', { name: g.upload }));
    await waitFor(() =>
      expect(srcs()).toContain(`https://apiv1.yekora.mx/v1/media/${SHA_NEW}`)
    );
    expect(api.drawSquare).toHaveBeenLastCalledWith(
      expect.anything(),
      BITMAP,
      { zoom: 2, x: 0.25, y: 0.75 },
      600
    );
    expect(api.uploadMedia).toHaveBeenCalledWith(blob);
    expect(screen.queryByRole('dialog', { name: g.cropTitle })).toBeNull();
    // The new photo is last, with empty alt texts, and goes to the API when the gallery is saved.
    api.replaceGallery.mockResolvedValue(ok(WITH_PHOTOS));
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() =>
      expect(api.replaceGallery).toHaveBeenCalledWith(7, {
        images: expect.arrayContaining([
          { sha256: SHA_NEW, altEs: null, altEn: null },
        ]),
      })
    );
  });

  it('opens the crop as a native modal and closes it with Escape or Cancel', async () => {
    await openGallery(TRAIL);
    showModal.mockClear();
    fireEvent.click(screen.getByRole('button', { name: g.addPhoto }));
    const modal = screen.getByRole('dialog', { name: g.cropTitle });
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(modal.tagName).toBe('DIALOG');
    // Escape is the browser's `cancel` event on the dialog.
    fireEvent(modal, new Event('cancel'));
    expect(screen.queryByRole('dialog', { name: g.cropTitle })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: g.addPhoto }));
    expect(showModal).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: g.cancel }));
    expect(screen.queryByRole('dialog', { name: g.cropTitle })).toBeNull();
  });

  it('does not add a photo twice, and tells it', async () => {
    api.drawSquare.mockReturnValue(true);
    api.canvasBlob.mockResolvedValue(new Blob(['w'], { type: 'image/webp' }));
    api.uploadMedia.mockResolvedValue(
      ok({
        code: 'MEDIA_ACCEPTED',
        created: false,
        sha256: SHA_A,
        mimeType: 'image/webp',
        width: 1200,
        height: 1200,
        sizeBytes: 4,
      } as const)
    );
    await openGallery(WITH_PHOTOS);
    await choosePhoto();
    fireEvent.click(screen.getByRole('button', { name: g.upload }));
    expect(await screen.findByText(g.duplicate)).toBeTruthy();
    expect(srcs()).toHaveLength(2);
  });

  it('says why a photo could not be used: unreadable, not prepared, or refused by the API', async () => {
    await openGallery(TRAIL);
    fireEvent.click(screen.getByRole('button', { name: g.addPhoto }));
    const input = screen.getByLabelText(g.choose) as HTMLInputElement;
    api.openImage.mockResolvedValueOnce(null);
    fireEvent.change(input, { target: { files: [PHOTO] } });
    expect(await screen.findByText(g.invalid)).toBeTruthy();
    // No file chosen (the dialog was cancelled): nothing changes.
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.getByText(g.invalid)).toBeTruthy();
    api.openImage.mockResolvedValue(BITMAP);
    fireEvent.change(input, { target: { files: [PHOTO] } });
    await screen.findByText(g.preview);
    expect(screen.queryByText(g.invalid)).toBeNull();
    // The browser gives no canvas, then cannot encode, then the API refuses the size.
    let uploadDraws = false;
    api.drawSquare.mockImplementation(
      (_canvas, _image, _crop, size) => size === 240 || uploadDraws
    );
    fireEvent.click(screen.getByRole('button', { name: g.upload }));
    expect(await screen.findByText(g.prepare)).toBeTruthy();
    uploadDraws = true;
    api.canvasBlob.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: g.upload }));
    await waitFor(() => expect(api.canvasBlob).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(g.prepare)).toBeTruthy();
    api.canvasBlob.mockResolvedValue(new Blob(['w'], { type: 'image/webp' }));
    api.uploadMedia.mockResolvedValue(no('MEDIA_SIZE_EXCEEDED'));
    fireEvent.click(screen.getByRole('button', { name: g.upload }));
    expect(await screen.findByText(t.errors.MEDIA_SIZE_EXCEEDED)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: g.cancel }));
    expect(screen.queryByRole('dialog', { name: g.cropTitle })).toBeNull();
  });

  it('stops offering photos at twelve', async () => {
    const full = {
      ...TRAIL,
      gallery: Array.from({ length: 12 }, (_, index) => ({
        sha256: index.toString(16).padStart(64, '0'),
        altEs: null,
        altEn: null,
        sortOrder: index,
        isPrimary: index === 0,
      })),
    };
    await openGallery(full);
    const button = screen.getByRole('button', {
      name: g.full,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
