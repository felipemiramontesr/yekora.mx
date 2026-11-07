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
  listBrands,
  publishCatalog,
  updateBrand,
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
  publishCatalog: vi.fn(),
}));

const api = {
  me: vi.mocked(me),
  listOrders: vi.mocked(listOrders),
  listBrands: vi.mocked(listBrands),
  createBrand: vi.mocked(createBrand),
  updateBrand: vi.mocked(updateBrand),
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

const renderConsole = () => render(<CatalogConsole texts={t} />);
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
