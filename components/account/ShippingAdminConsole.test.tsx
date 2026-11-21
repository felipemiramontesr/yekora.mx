// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { ShippingAdminView } from '@/lib/account/shippingAdminTypes';
import {
  readShippingAdmin,
  saveShippingConfig,
  saveShippingRules,
} from '@/lib/api/shippingAdminClient';
import { ShippingAdminConsole } from './ShippingAdminConsole';

vi.mock('@/lib/api/shippingAdminClient', () => ({
  readShippingAdmin: vi.fn(),
  saveShippingConfig: vi.fn(),
  saveShippingRules: vi.fn(),
}));

const api = {
  read: vi.mocked(readShippingAdmin),
  config: vi.mocked(saveShippingConfig),
  rules: vi.mocked(saveShippingRules),
};

const t = getMessages('es-MX').account.shipping;

const view = (
  overrides: Partial<ShippingAdminView['config']> = {}
): ShippingAdminView => ({
  config: {
    strategyId: 2,
    isFreeShippingActive: false,
    freeShippingThresholdMxnCents: null,
    ...overrides,
  },
  strategies: [
    {
      id: 1,
      code: 'FLAT_RATE',
      nameEs: 'Tarifa fija',
      nameEn: 'Flat rate',
      administrable: false,
    },
    {
      id: 2,
      code: 'ZONE_RATE',
      nameEs: 'Tarifa por estado',
      nameEn: 'Rate by state',
      administrable: true,
    },
  ],
  classes: [],
  zones: [
    { id: 1, code: 'AGU', nameEs: 'Aguascalientes', nameEn: 'Aguascalientes' },
    { id: 7, code: 'CMX', nameEs: 'Ciudad de México', nameEn: 'Mexico City' },
  ],
  rules: [
    { zoneId: 1, rateMxnCents: 15000 },
    { zoneId: 7, rateMxnCents: 9950 },
  ],
});

const ok = (data: ShippingAdminView) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const open = async (locale: Locale = 'es-MX', data = view()) => {
  api.read.mockResolvedValue(ok(data));
  render(
    <ShippingAdminConsole
      texts={getMessages(locale).account.shipping}
      locale={locale}
    />
  );
  await screen.findByText(getMessages(locale).account.shipping.strategyTitle);
};

const rate = (state: string) =>
  screen.getByLabelText(`Tarifa de envío a ${state}`) as HTMLInputElement;

beforeEach(() => {
  api.config.mockResolvedValue(ok(view()));
  api.rules.mockResolvedValue(ok(view()));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('shipping console (FC 061 F1)', () => {
  it('shows the loading text, then the active strategy, the free-shipping form and a rate for each state', async () => {
    api.read.mockReturnValue(new Promise(() => undefined));
    render(<ShippingAdminConsole texts={t} locale="es-MX" />);
    expect(screen.getByText(t.loading)).toBeTruthy();
    cleanup();
    await open();
    expect(
      screen.getByText('Estrategia activa: Tarifa por estado.')
    ).toBeTruthy();
    expect(rate('Aguascalientes').value).toBe('150.00');
    expect(rate('Ciudad de México').value).toBe('99.50');
    expect(screen.queryByLabelText(t.freeThreshold)).toBeNull();
  });

  it('names the states and the strategy in English', async () => {
    await open('en');
    expect(screen.getByText('Active strategy: Rate by state.')).toBeTruthy();
    expect(screen.getByLabelText('Shipping rate to Mexico City')).toBeTruthy();
  });

  it('says what failed when the first read is refused, and never shows the forms', async () => {
    api.read.mockResolvedValue(no('PERMISSION_DENIED'));
    render(<ShippingAdminConsole texts={t} locale="es-MX" />);
    expect(await screen.findByText(t.errors.PERMISSION_DENIED)).toBeTruthy();
    expect(screen.queryByText(t.ratesTitle)).toBeNull();
  });

  it('shows the threshold of free shipping already on, in pesos', async () => {
    await open(
      'es-MX',
      view({
        isFreeShippingActive: true,
        freeShippingThresholdMxnCents: 150000,
      })
    );
    expect(
      (screen.getByLabelText(t.freeThreshold) as HTMLInputElement).value
    ).toBe('1500.00');
  });

  it('CONFIG_MUTATION_APPLIED_200 · saves free shipping with its threshold in cents and confirms', async () => {
    await open();
    fireEvent.click(screen.getByLabelText(t.freeToggle));
    fireEvent.change(screen.getByLabelText(t.freeThreshold), {
      target: { value: ' 1500.5 ' },
    });
    api.config.mockResolvedValue(
      ok(
        view({
          isFreeShippingActive: true,
          freeShippingThresholdMxnCents: 150050,
        })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: t.saveFree }));
    await screen.findByText(t.saved);
    expect(api.config).toHaveBeenCalledWith({
      strategyId: 2,
      isFreeShippingActive: true,
      freeShippingThresholdMxnCents: 150050,
    });
    expect(
      (screen.getByLabelText(t.freeThreshold) as HTMLInputElement).value
    ).toBe('1500.50');
  });

  it('turns free shipping off with a null threshold', async () => {
    await open(
      'es-MX',
      view({
        isFreeShippingActive: true,
        freeShippingThresholdMxnCents: 150000,
      })
    );
    fireEvent.click(screen.getByLabelText(t.freeToggle));
    fireEvent.click(screen.getByRole('button', { name: t.saveFree }));
    await screen.findByText(t.saved);
    expect(api.config).toHaveBeenCalledWith({
      strategyId: 2,
      isFreeShippingActive: false,
      freeShippingThresholdMxnCents: null,
    });
  });

  it.each(['', '0', '0.00', 'abc', '-5', '1,5', '1.234', '100000.01'])(
    'refuses the threshold %j without calling the API',
    async (typed) => {
      await open();
      fireEvent.click(screen.getByLabelText(t.freeToggle));
      fireEvent.change(screen.getByLabelText(t.freeThreshold), {
        target: { value: typed },
      });
      fireEvent.click(screen.getByRole('button', { name: t.saveFree }));
      expect(await screen.findByText(t.invalidAmount)).toBeTruthy();
      expect(api.config).not.toHaveBeenCalled();
    }
  );

  it('RULE_MUTATION_ADMITTED_200 · saves one rate for each state, in cents, and shows the saved view', async () => {
    await open();
    fireEvent.change(rate('Aguascalientes'), { target: { value: '120' } });
    fireEvent.change(rate('Ciudad de México'), { target: { value: '0' } });
    api.rules.mockResolvedValue(
      ok({
        ...view(),
        rules: [
          { zoneId: 1, rateMxnCents: 12000 },
          { zoneId: 7, rateMxnCents: 0 },
        ],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: t.saveRates }));
    await screen.findByText(t.saved);
    expect(api.rules).toHaveBeenCalledWith({
      rules: [
        { zoneId: 1, rateMxnCents: 12000 },
        { zoneId: 7, rateMxnCents: 0 },
      ],
    });
    expect(rate('Aguascalientes').value).toBe('120.00');
    expect(rate('Ciudad de México').value).toBe('0.00');
  });

  it.each(['', 'abc', '-1', '10.555', '100001'])(
    'RULE_MUTATION_REJECTED_400 · refuses the rate %j in the browser, before the API',
    async (typed) => {
      await open();
      fireEvent.change(rate('Aguascalientes'), { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: t.saveRates }));
      expect(await screen.findByText(t.invalidAmount)).toBeTruthy();
      expect(api.rules).not.toHaveBeenCalled();
    }
  );

  it('names the refusal of a write by its code, and an unknown one generically', async () => {
    await open();
    api.rules.mockResolvedValueOnce(no('SHIPPING_ZONE_UNKNOWN'));
    fireEvent.click(screen.getByRole('button', { name: t.saveRates }));
    expect(
      await screen.findByText(t.errors.SHIPPING_ZONE_UNKNOWN)
    ).toBeTruthy();
    api.config.mockResolvedValueOnce(no('weird'));
    fireEvent.click(screen.getByRole('button', { name: t.saveFree }));
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
  });

  it('blocks the buttons while a write runs', async () => {
    await open();
    const pending = Promise.withResolvers<ReturnType<typeof ok>>();
    api.rules.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: t.saveRates }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t.saving })).toHaveLength(2)
    );
    pending.resolve(ok(view()));
    await screen.findByText(t.saved);
  });

  it('leaves a state without a rate empty, and refuses to save until it has one', async () => {
    const data = view();
    data.rules = [{ zoneId: 1, rateMxnCents: 15000 }];
    await open('es-MX', data);
    expect(rate('Ciudad de México').value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: t.saveRates }));
    expect(await screen.findByText(t.invalidAmount)).toBeTruthy();
    expect(api.rules).not.toHaveBeenCalled();
  });

  it('shows an empty name when the active strategy is not in the catalog', async () => {
    await open('es-MX', view({ strategyId: 9 }));
    expect(screen.getByText('Estrategia activa: .')).toBeTruthy();
  });

  it('does not show a read that answers after the console closed', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof ok>>();
    api.read.mockReturnValue(pending.promise);
    const { unmount } = render(
      <ShippingAdminConsole texts={t} locale="es-MX" />
    );
    unmount();
    pending.resolve(ok(view()));
    await Promise.resolve();
    expect(screen.queryByText(t.ratesTitle)).toBeNull();
  });
});
