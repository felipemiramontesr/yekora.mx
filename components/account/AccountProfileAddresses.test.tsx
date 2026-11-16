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
import { getMessages, type Locale } from '@/app/i18n';
import type { AddressView } from '@/lib/account/addressTypes';
import type { MeResponse } from '@/lib/account/authTypes';
import { syncHeaderUser } from '@/lib/account/headerSession';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  updateProfile,
} from '@/lib/api/accountDataClient';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import { AccountProfileAddresses } from './AccountProfileAddresses';

vi.mock('@/lib/api/accountDataClient', () => ({
  createAddress: vi.fn(),
  deleteAddress: vi.fn(),
  listAddresses: vi.fn(),
  updateAddress: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('@/lib/account/headerSession', () => ({ syncHeaderUser: vi.fn() }));

const api = {
  create: vi.mocked(createAddress),
  remove: vi.mocked(deleteAddress),
  list: vi.mocked(listAddresses),
  update: vi.mocked(updateAddress),
  profile: vi.mocked(updateProfile),
};
const header = vi.mocked(syncHeaderUser);

const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const ANA: MeResponse = {
  id: 'f0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Pérez',
  roles: ['customer'],
  permissions: ['account:self'],
  phone: '4929421780',
  postalCode: '98612',
  stateCode: 'ZAC',
};

const view = (over: Partial<AddressView> = {}): AddressView => ({
  id: 'a0000000-0000-4000-8000-000000000001',
  isDefault: true,
  isComplete: true,
  stateCode: 'ZAC',
  postalCode: '98612',
  label: 'Casa',
  name: 'Ana Pérez',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  interiorNumber: null,
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  references: null,
  ...over,
});
const OFICINA = view({
  id: 'a0000000-0000-4000-8000-000000000002',
  isDefault: false,
  label: 'Oficina',
  street: 'Calle Hidalgo',
  postalCode: '98000',
});
const INCOMPLETE = view({
  id: 'a0000000-0000-4000-8000-000000000003',
  isDefault: false,
  isComplete: false,
  label: null,
  name: null,
  phone: null,
  street: null,
  exteriorNumber: null,
  neighborhood: null,
  municipality: null,
  postalCode: '98000',
});

const book = (items: AddressView[], max = 5) => ok({ items, max });
const chosen = vi.fn();

function show(
  items: AddressView[],
  options: { user?: MeResponse; locale?: Locale; max?: number } = {}
) {
  api.list.mockResolvedValue(book(items, options.max));
  const locale = options.locale ?? 'es-MX';
  return render(
    <AccountProfileAddresses
      user={options.user ?? ANA}
      messages={getMessages(locale).account}
      locale={locale}
      onChanged={chosen}
    />
  );
}

const t = getMessages('es-MX').account.data;
const addressForm = () => screen.getByRole('form', { name: t.form.titleNew });
const type = (label: string, value: string, scope: HTMLElement) =>
  fireEvent.change(within(scope).getByLabelText(label), {
    target: { value },
  });

beforeEach(() => {
  getDestinationStore().setState(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('profile of the account (FC 051 T1.1, T2.3)', () => {
  it('shows the e-mail as text, never as a field, with the name and the phone to edit', async () => {
    show([]);
    const form = await screen.findByRole('form', { name: t.profile.title });
    expect(within(form).getByText('ana@example.test')).toBeTruthy();
    expect(within(form).getByText(t.profile.emailNote)).toBeTruthy();
    expect(within(form).queryByLabelText(t.profile.email)).toBeNull();
    expect(
      (within(form).getByLabelText(t.profile.fullName) as HTMLInputElement)
        .value
    ).toBe('Ana Pérez');
    expect(
      (within(form).getByLabelText(t.profile.phone) as HTMLInputElement).value
    ).toBe('4929421780');
    expect(within(form).queryByText(t.profile.incomplete)).toBeNull();
  });

  it('asks for the phone when the account has none', async () => {
    show([], { user: { ...ANA, phone: null } });
    const form = await screen.findByRole('form', { name: t.profile.title });
    expect(within(form).getByText(t.profile.incomplete)).toBeTruthy();
  });

  it('refuses a short phone and an empty name before asking the API', async () => {
    show([]);
    const form = await screen.findByRole('form', { name: t.profile.title });
    type(t.profile.phone, '49294', form);
    type(t.profile.fullName, '', form);
    fireEvent.submit(form);
    expect(await within(form).findByText(t.errors.phone)).toBeTruthy();
    expect(within(form).getByText(t.errors.fullName)).toBeTruthy();
    expect(api.profile).not.toHaveBeenCalled();
  });

  it('saves the name and the phone, tells the area, and shows what failed', async () => {
    api.profile.mockResolvedValue(ok({ fullName: 'Ana P. López' }));
    show([]);
    const form = await screen.findByRole('form', { name: t.profile.title });
    type(t.profile.fullName, 'Ana P. López', form);
    type(t.profile.phone, '4929421781', form);
    fireEvent.submit(form);
    expect(await screen.findByText(t.profile.saved)).toBeTruthy();
    expect(api.profile).toHaveBeenCalledWith({
      fullName: 'Ana P. López',
      phone: '4929421781',
    });
    await waitFor(() => expect(chosen).toHaveBeenCalled());
    api.profile.mockResolvedValue(no('SERVICE_UNAVAILABLE'));
    fireEvent.submit(form);
    expect(await screen.findByText(t.errors.SERVICE_UNAVAILABLE)).toBeTruthy();
  });
});

describe('book of addresses (FC 051 T1.4, T2.6)', () => {
  it('lists each address with its default mark, its count and what is missing in an incomplete one', async () => {
    show([view(), OFICINA, INCOMPLETE]);
    expect(await screen.findByText('Casa')).toBeTruthy();
    expect(screen.getAllByText(t.addresses.default)).toHaveLength(1);
    expect(screen.getByText('3 de 5 domicilios')).toBeTruthy();
    expect(screen.getByText(/Calle Hidalgo 209/)).toBeTruthy();
    expect(screen.getByText(t.addresses.incomplete)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: `${t.addresses.complete}: ${t.addresses.unlabeled}`,
      })
    ).toBeTruthy();
    // The default one cannot be made default again.
    expect(
      screen.queryByRole('button', { name: `${t.addresses.makeDefault}: Casa` })
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: `${t.addresses.makeDefault}: Oficina`,
      })
    ).toBeTruthy();
  });

  it('says so when there are none, and names the state in the language of the page', async () => {
    show([]);
    expect(await screen.findByText(t.addresses.empty)).toBeTruthy();
    cleanup();
    show([view({ stateCode: 'CMX' })], { locale: 'en' });
    expect(await screen.findByText(/Mexico City, 98612/)).toBeTruthy();
  });

  it('tells the header and the cart where the default address is, keeping only the state', async () => {
    show([OFICINA, view({ stateCode: 'JAL' })]);
    await screen.findByText('Casa');
    expect(getDestinationStore().getSnapshot()).toBe('JAL');
    expect(header).toHaveBeenCalled();
    // The browser keeps the state and nothing else of the address (FC 051 T2.6).
    expect(JSON.stringify({ ...localStorage })).not.toContain('98612');
    expect(JSON.stringify({ ...localStorage })).not.toContain('Barones');
  });

  it('leaves the state alone when there is no default address', async () => {
    getDestinationStore().setState('YUC');
    show([OFICINA]);
    await screen.findByText('Oficina');
    expect(getDestinationStore().getSnapshot()).toBe('YUC');
  });

  it('shows an unknown state by its code, and the references of an address', async () => {
    show([view({ stateCode: 'XXX', references: 'Portón negro' })]);
    expect(await screen.findByText(/XXX, 98612/)).toBeTruthy();
    expect(screen.getByText(/Portón negro/)).toBeTruthy();
  });

  it('starts a new address without a phone when the account has none', async () => {
    show([], { user: { ...ANA, phone: null } });
    await screen.findByText(t.addresses.empty);
    fireEvent.click(screen.getByRole('button', { name: t.addresses.new }));
    expect(
      (within(addressForm()).getByLabelText(t.form.phone) as HTMLInputElement)
        .value
    ).toBe('');
  });

  it('shows the refusal of making an address the default', async () => {
    api.update.mockResolvedValue(no('ADDRESS_NOT_FOUND'));
    show([view(), OFICINA]);
    await screen.findByText('Casa');
    fireEvent.click(
      screen.getByRole('button', {
        name: `${t.addresses.makeDefault}: Oficina`,
      })
    );
    expect(await screen.findByText(t.errors.ADDRESS_NOT_FOUND)).toBeTruthy();
  });

  it('says why the book could not be read', async () => {
    api.list.mockResolvedValue(no('SESSION_INVALID_OR_EXPIRED'));
    render(
      <AccountProfileAddresses
        user={ANA}
        messages={getMessages('es-MX').account}
        locale="es-MX"
        onChanged={chosen}
      />
    );
    expect(
      await screen.findByText(t.errors.SESSION_INVALID_OR_EXPIRED)
    ).toBeTruthy();
    expect(screen.getByText(t.loading)).toBeTruthy();
  });

  it('adds an address: prefilled with the person, the state from the postal code, sent whole', async () => {
    api.create.mockResolvedValue(
      ok({ id: OFICINA.id, isDefault: false, isComplete: true })
    );
    show([view()]);
    await screen.findByText('Casa');
    fireEvent.click(screen.getByRole('button', { name: t.addresses.new }));
    const form = addressForm();
    expect(
      (within(form).getByLabelText(t.form.name) as HTMLInputElement).value
    ).toBe('Ana Pérez');
    expect(
      (within(form).getByLabelText(t.form.phone) as HTMLInputElement).value
    ).toBe('4929421780');
    expect(within(form).getByText(t.form.stateUnknown)).toBeTruthy();
    type(t.form.label, 'Oficina', form);
    type(t.form.street, 'Calle Hidalgo', form);
    type(t.form.exteriorNumber, '12', form);
    type(t.form.neighborhood, 'Centro', form);
    type(t.form.municipality, 'Zacatecas', form);
    type(t.form.postalCode, '98000', form);
    expect(within(form).getByText('Zacatecas', { exact: false })).toBeTruthy();
    fireEvent.click(within(form).getByLabelText(t.form.isDefault));
    api.list.mockResolvedValue(book([view(), OFICINA]));
    fireEvent.submit(form);
    expect(await screen.findByText(t.addresses.saved)).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith({
      label: 'Oficina',
      name: 'Ana Pérez',
      phone: '4929421780',
      street: 'Calle Hidalgo',
      exteriorNumber: '12',
      neighborhood: 'Centro',
      municipality: 'Zacatecas',
      stateCode: 'ZAC',
      postalCode: '98000',
      isDefault: true,
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('form', { name: t.form.titleNew })).toBeNull();
    expect(chosen).toHaveBeenCalled();
  });

  it('shows what is wrong with each field and sends nothing', async () => {
    show([]);
    await screen.findByText(t.addresses.empty);
    fireEvent.click(screen.getByRole('button', { name: t.addresses.new }));
    const form = addressForm();
    type(t.form.name, '', form);
    type(t.form.phone, '123', form);
    type(t.form.postalCode, '17000', form);
    fireEvent.submit(form);
    expect(await within(form).findByText(t.errors.name)).toBeTruthy();
    expect(within(form).getByText(t.errors.phone)).toBeTruthy();
    expect(within(form).getByText(t.errors.postalCode)).toBeTruthy();
    expect(within(form).getAllByText(t.errors.required).length).toBeGreaterThan(
      0
    );
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole('button', { name: t.form.cancel }));
    expect(screen.queryByRole('form', { name: t.form.titleNew })).toBeNull();
  });

  it('completes the address given at sign-up, which only held its postal code', async () => {
    api.update.mockResolvedValue(
      ok({ id: INCOMPLETE.id, isDefault: false, isComplete: true })
    );
    show([view(), INCOMPLETE]);
    await screen.findByText('Casa');
    fireEvent.click(
      screen.getByRole('button', {
        name: `${t.addresses.complete}: ${t.addresses.unlabeled}`,
      })
    );
    const form = screen.getByRole('form', { name: t.form.titleEdit });
    expect(
      (within(form).getByLabelText(t.form.postalCode) as HTMLInputElement).value
    ).toBe('98000');
    expect(
      (within(form).getByLabelText(t.form.street) as HTMLInputElement).value
    ).toBe('');
    // What the address does not hold yet is the person's own name and phone.
    expect(
      (within(form).getByLabelText(t.form.name) as HTMLInputElement).value
    ).toBe('Ana Pérez');
    type(t.form.street, 'Calle Hidalgo', form);
    type(t.form.exteriorNumber, '12', form);
    type(t.form.neighborhood, 'Centro', form);
    type(t.form.municipality, 'Zacatecas', form);
    fireEvent.submit(form);
    expect(await screen.findByText(t.addresses.saved)).toBeTruthy();
    expect(api.update).toHaveBeenCalledWith(
      INCOMPLETE.id,
      expect.objectContaining({ street: 'Calle Hidalgo', postalCode: '98000' })
    );
  });

  it('names the refusal of a write: the sixth address, and an address that is gone', async () => {
    api.create.mockResolvedValue(no('ADDRESS_LIMIT_REACHED'));
    show([view()]);
    await screen.findByText('Casa');
    fireEvent.click(screen.getByRole('button', { name: t.addresses.new }));
    const form = addressForm();
    for (const [label, value] of [
      [t.form.street, 'Calle Hidalgo'],
      [t.form.exteriorNumber, '12'],
      [t.form.neighborhood, 'Centro'],
      [t.form.municipality, 'Zacatecas'],
      [t.form.postalCode, '98000'],
    ] as const) {
      type(label, value, form);
    }
    fireEvent.submit(form);
    expect(
      await screen.findByText(t.errors.ADDRESS_LIMIT_REACHED)
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: t.form.titleNew })).toBeTruthy();
  });

  it('makes another address the default, and says so', async () => {
    api.update.mockResolvedValue(
      ok({ id: OFICINA.id, isDefault: true, isComplete: true })
    );
    show([view(), OFICINA]);
    await screen.findByText('Casa');
    api.list.mockResolvedValue(
      book([view({ isDefault: false }), { ...OFICINA, isDefault: true }])
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: `${t.addresses.makeDefault}: Oficina`,
      })
    );
    expect(await screen.findByText(t.addresses.madeDefault)).toBeTruthy();
    expect(api.update).toHaveBeenCalledWith(OFICINA.id, { isDefault: true });
    await waitFor(() =>
      expect(getDestinationStore().getSnapshot()).toBe('ZAC')
    );
  });

  it('asks before deleting, keeps the address if told to, and deletes it when confirmed', async () => {
    api.remove.mockResolvedValue(ok(undefined));
    show([view(), OFICINA]);
    await screen.findByText('Casa');
    fireEvent.click(
      screen.getByRole('button', { name: `${t.addresses.remove}: Oficina` })
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(t.addresses.confirm.title)).toBeTruthy();
    expect(within(dialog).getByText(t.addresses.confirm.text)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: t.addresses.confirm.no })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: `${t.addresses.remove}: Oficina` })
    );
    api.list.mockResolvedValue(book([view()]));
    fireEvent.click(
      screen.getByRole('button', { name: t.addresses.confirm.yes })
    );
    expect(await screen.findByText(t.addresses.removed)).toBeTruthy();
    expect(api.remove).toHaveBeenCalledWith(OFICINA.id);
    await waitFor(() => expect(screen.queryByText('Oficina')).toBeNull());
  });

  it('shows the refusal of a delete and keeps the confirmation open', async () => {
    api.remove.mockResolvedValue(no('ADDRESS_NOT_FOUND'));
    show([view(), OFICINA]);
    await screen.findByText('Casa');
    fireEvent.click(
      screen.getByRole('button', { name: `${t.addresses.remove}: Oficina` })
    );
    fireEvent.click(
      screen.getByRole('button', { name: t.addresses.confirm.yes })
    );
    expect(await screen.findByText(t.errors.ADDRESS_NOT_FOUND)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stops offering new addresses at the limit, and says why', async () => {
    const five = Array.from({ length: 5 }, (_, n) =>
      view({
        id: `a0000000-0000-4000-8000-00000000010${n}`,
        isDefault: n === 0,
        label: `Casa ${n}`,
      })
    );
    show(five);
    await screen.findByText('Casa 0');
    expect(
      (
        screen.getByRole('button', {
          name: t.addresses.new,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(/Ya tienes 5 domicilios/)).toBeTruthy();
  });
});
