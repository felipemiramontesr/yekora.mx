// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import type { OrderDetail } from '@/lib/account/orderTypes';
import {
  confirm,
  enroll,
  forgetDevice,
  forgotPassword,
  listOrders,
  login,
  logout,
  me,
  readOrder,
  register,
  resetPassword,
  verify,
} from '@/lib/api/accountClient';
import { AccountView } from '../views/AccountView';
import { AccountApp } from './AccountApp';

vi.mock('@/lib/api/accountClient', () => ({
  register: vi.fn(),
  login: vi.fn(),
  verify: vi.fn(),
  enroll: vi.fn(),
  confirm: vi.fn(),
  forgetDevice: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  listOrders: vi.fn(),
  readOrder: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

const api = {
  register: vi.mocked(register),
  login: vi.mocked(login),
  verify: vi.mocked(verify),
  enroll: vi.mocked(enroll),
  confirm: vi.mocked(confirm),
  forgetDevice: vi.mocked(forgetDevice),
  me: vi.mocked(me),
  logout: vi.mocked(logout),
  listOrders: vi.mocked(listOrders),
  readOrder: vi.mocked(readOrder),
  forgotPassword: vi.mocked(forgotPassword),
  resetPassword: vi.mocked(resetPassword),
};

/** Meets every rule of FC 042 for Ana Flores. */
const STRONG = 'Ruta-Nevado7#Sur';

const { account, checkout } = getMessages('es-MX');
const CHALLENGE = 'c0000000-0000-4000-8000-000000000001';
const ORDER = 'YEK-2026-AB12CD34';

const BUYER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Flores',
  roles: ['customer'],
  permissions: ['account:self'],
};
const STAFF = {
  ...BUYER,
  fullName: 'Luis Staff',
  roles: ['staff_orders'],
  permissions: ['account:self', 'orders:read'],
};

const SUMMARY = {
  orderNumber: ORDER,
  status: 'PAID',
  method: 'CARD',
  itemsTotalMxnCents: 185000,
  shippingTotalMxnCents: 15000,
  totalMxnCents: 200000,
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-01T11:00:00.000Z',
  paidAt: '2026-11-01T10:20:00.000Z',
  isTest: true,
} as const;

const DETAIL: OrderDetail = {
  ...SUMMARY,
  status: 'PENDING_PAYMENT',
  paidAt: null,
  lines: [
    {
      sku: 'PACK',
      quantity: 1,
      unitPriceMxnCents: 185000,
      lineTotalMxnCents: 185000,
    },
  ],
  paymentEvents: [
    {
      processor: 'STRIPE',
      eventType: 'checkout.session.completed',
      processorStatus: 'paid',
      amountMxnCents: 200000,
      resultingStatus: 'PAID',
      isAlert: false,
      receivedAt: '2026-11-01T10:20:00.000Z',
    },
    {
      processor: 'MERCADO_PAGO',
      eventType: 'payment',
      processorStatus: null,
      amountMxnCents: null,
      resultingStatus: null,
      isAlert: true,
      receivedAt: '2026-11-01T12:00:00.000Z',
    },
  ],
};

const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

function renderApp() {
  return render(
    <AccountApp
      locale="es-MX"
      messages={account}
      methods={checkout.method.options}
    />
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  globalThis.history.replaceState(null, '', '/cuenta/');
  api.me.mockResolvedValue(no('SESSION_INVALID_OR_EXPIRED'));
  api.listOrders.mockResolvedValue(
    ok({ items: [], page: 1, pageSize: 20, total: 0 })
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account area · signing in (FC 028 F2)', () => {
  it('lets a late "no session" answer leave someone who moved on alone (cold start)', async () => {
    let answer!: (value: never) => void;
    api.me.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    renderApp();
    press(account.signIn.toRegister);
    expect(
      screen.getByRole('heading', { name: account.register.title })
    ).toBeTruthy();
    await act(async () => answer(no('SESSION_INVALID_OR_EXPIRED')));
    expect(
      screen.getByRole('heading', { name: account.register.title })
    ).toBeTruthy();
  });

  it('signs a buyer in with the mailed code and shows their orders', async () => {
    renderApp();
    // The form is there at once, before the session check answers: no jump.
    expect(
      screen.getByRole('heading', { name: account.signIn.title })
    ).toBeTruthy();
    await waitFor(() => expect(api.me).toHaveBeenCalled());
    press(account.signIn.submit);
    expect(screen.getByRole('alert').textContent).toBe(account.errors.required);
    api.login.mockResolvedValueOnce(no('INVALID_CREDENTIALS'));
    type(account.signIn.email, 'ana@example.test');
    type(account.signIn.password, 'wrong password');
    press(account.signIn.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.INVALID_CREDENTIALS
      )
    );
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'email' })
    );
    press(account.signIn.submit);
    await screen.findByRole('heading', { name: account.code.titleEmail });
    expect(screen.getByText(/ana@example\.test/)).toBeTruthy();
    press(account.code.submit);
    expect(screen.getByRole('alert').textContent).toBe(
      account.errors.codeFormat
    );
    api.verify.mockResolvedValueOnce(no('INVALID_CODE'));
    type(account.code.label, '12a3456');
    press(account.code.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.INVALID_CODE
      )
    );
    expect(api.verify).toHaveBeenLastCalledWith({
      challengeId: CHALLENGE,
      code: '123456',
    });
    api.verify.mockResolvedValueOnce(ok({ status: 'signed_in' }));
    api.me.mockResolvedValueOnce(ok(BUYER));
    press(account.code.submit);
    await screen.findByText('Hola, Ana Flores');
    await screen.findByText(account.orders.empty);
    expect(screen.queryByText(account.dashboard.panel)).toBeNull();
  });

  it('says why the session could not be read, other than being signed out', async () => {
    api.me.mockResolvedValueOnce(no('offline'));
    renderApp();
    expect(await screen.findByText(account.errors.offline)).toBeTruthy();
  });

  it('creates an account, then signs in with the e-mail filled in', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    press(account.signIn.toRegister);
    const submit = () =>
      screen.getByRole('button', {
        name: account.register.submit,
      }) as HTMLButtonElement;
    // FC 042 T1.4: «Crear cuenta» stays off until the password meets every rule and both match.
    expect(submit().disabled).toBe(true);
    type(account.register.password, STRONG);
    type(account.register.confirm, STRONG);
    press(account.register.submit);
    expect(screen.getByRole('alert').textContent).toBe(account.errors.required);
    type(account.register.fullName, 'Ana Flores');
    type(account.register.email, ' ana@example.test ');
    type(account.register.password, 'short');
    expect(submit().disabled).toBe(true);
    type(account.register.password, STRONG);
    type(account.register.confirm, `${STRONG}x`);
    expect(submit().disabled).toBe(true);
    type(account.register.confirm, STRONG);
    expect(submit().disabled).toBe(false);
    api.register.mockResolvedValueOnce(no('PASSWORD_COMMON'));
    press(account.register.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.PASSWORD_COMMON
      )
    );
    api.register.mockResolvedValueOnce(ok({ status: 'accepted' }));
    press(account.register.submit);
    await screen.findByText(account.register.accepted);
    // T2.7: the repetition never travels.
    expect(api.register).toHaveBeenLastCalledWith({
      email: 'ana@example.test',
      password: STRONG,
      fullName: 'Ana Flores',
    });
    expect(
      (screen.getByLabelText(account.signIn.email) as HTMLInputElement).value
    ).toBe('ana@example.test');
    press(account.signIn.toRegister);
    press(account.register.toSignIn);
    await screen.findByRole('heading', { name: account.signIn.title });
  });

  it('makes staff turn the authenticator on, shows the backup codes once and signs in', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'email' })
    );
    type(account.signIn.email, 'luis@example.test');
    type(account.signIn.password, 'correct horse battery');
    press(account.signIn.submit);
    await screen.findByRole('heading', { name: account.code.titleEmail });
    api.verify.mockResolvedValueOnce(no('TOTP_NOT_ENROLLED'));
    let secret!: (value: unknown) => void;
    api.enroll.mockReturnValueOnce(
      new Promise((resolve) => {
        secret = resolve;
      }) as never
    );
    type(account.code.label, '123456');
    press(account.code.submit);
    await screen.findByText(account.enroll.loading);
    await act(async () =>
      secret(
        ok({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Y:luis?secret=JBSWY3DPEHPK3PXP',
        })
      )
    );
    const qr = screen.getByAltText(account.enroll.qrAlt) as HTMLImageElement;
    expect(qr.src).toMatch(/^data:image\/gif;base64,/);
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: account.enroll.openApp })
        .getAttribute('href')
    ).toContain('otpauth://totp/');
    type(account.enroll.label, '12345678');
    press(account.enroll.submit);
    expect(screen.getByRole('alert').textContent).toBe(
      account.errors.codeFormat
    );
    api.confirm.mockResolvedValueOnce(no('INVALID_CODE'));
    type(account.enroll.label, '654321');
    press(account.enroll.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.INVALID_CODE
      )
    );
    const codes = Array.from({ length: 8 }, (_, i) => `1234567${i}`);
    api.confirm.mockResolvedValueOnce(ok({ backupCodes: codes }));
    press(account.enroll.submit);
    const list = await screen.findByRole('list', {
      name: account.backup.listLabel,
    });
    expect(list.textContent).toContain('12345670');
    api.me.mockResolvedValueOnce(ok(STAFF));
    press(account.backup.continue);
    await screen.findByText('Hola, Luis Staff');
  });

  it('says why the authenticator secret could not be issued, and lets the person start over', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'authenticator' })
    );
    type(account.signIn.email, 'luis@example.test');
    type(account.signIn.password, 'correct horse battery');
    press(account.signIn.submit);
    await screen.findByRole('heading', {
      name: account.code.titleAuthenticator,
    });
    expect(screen.getByText(account.code.hintAuthenticator)).toBeTruthy();
    api.verify.mockResolvedValueOnce(no('TOTP_NOT_ENROLLED'));
    api.enroll.mockResolvedValueOnce(no('INVALID_CHALLENGE'));
    type(account.code.label, '123456');
    press(account.code.submit);
    await screen.findByText(account.errors.INVALID_CHALLENGE);
    press(account.code.restart);
    await screen.findByRole('heading', { name: account.signIn.title });
  });

  it('starts over from the code step', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'email' })
    );
    type(account.signIn.email, 'ana@example.test');
    type(account.signIn.password, 'p');
    press(account.signIn.submit);
    await screen.findByRole('heading', { name: account.code.titleEmail });
    press(account.code.restart);
    expect(
      await screen.findByRole('heading', { name: account.signIn.title })
    ).toBeTruthy();
  });

  it('ignores a secret that arrives after the person left the step', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'email' })
    );
    type(account.signIn.email, 'luis@example.test');
    type(account.signIn.password, 'p');
    press(account.signIn.submit);
    await screen.findByRole('heading', { name: account.code.titleEmail });
    api.verify.mockResolvedValueOnce(no('TOTP_NOT_ENROLLED'));
    let secret!: (value: unknown) => void;
    api.enroll.mockReturnValueOnce(
      new Promise((resolve) => {
        secret = resolve;
      }) as never
    );
    type(account.code.label, '123456');
    press(account.code.submit);
    await screen.findByText(account.enroll.loading);
    press(account.code.restart);
    await act(async () =>
      secret(ok({ secret: 'A', otpauthUri: 'otpauth://totp/x' }))
    );
    expect(screen.queryByAltText(account.enroll.qrAlt)).toBeNull();
  });
});

describe('account area · trusted device (FC 028 Enmienda 1, E2)', () => {
  it('tells the buyer to look in Spam if the code is late (T2.6f), and remembers the device when asked', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'email' })
    );
    type(account.signIn.email, 'ana@example.test');
    type(account.signIn.password, 'p');
    press(account.signIn.submit);
    await screen.findByRole('heading', { name: account.code.titleEmail });
    expect(screen.getByText(/Spam/).textContent).toContain('ana@example.test');
    expect(screen.getByText(account.code.rememberHint)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(account.code.remember));
    api.verify.mockResolvedValueOnce(ok({ status: 'signed_in' }));
    api.me.mockResolvedValueOnce(ok(BUYER));
    type(account.code.label, '123456');
    press(account.code.submit);
    await screen.findByText('Hola, Ana Flores');
    expect(api.verify).toHaveBeenLastCalledWith({
      challengeId: CHALLENGE,
      code: '123456',
      rememberDevice: true,
    });
  });

  it('never offers to remember the device when the code comes from the authenticator', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(
      ok({ challengeId: CHALLENGE, next: 'verify', channel: 'authenticator' })
    );
    type(account.signIn.email, 'luis@example.test');
    type(account.signIn.password, 'p');
    press(account.signIn.submit);
    await screen.findByRole('heading', {
      name: account.code.titleAuthenticator,
    });
    expect(screen.queryByLabelText(account.code.remember)).toBeNull();
  });

  it('signs straight in on a remembered device (201), and forgets it on request', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    api.login.mockResolvedValueOnce(ok({ status: 'signed_in' }) as never);
    api.me.mockResolvedValueOnce(ok(BUYER));
    type(account.signIn.email, 'ana@example.test');
    type(account.signIn.password, 'p');
    press(account.signIn.submit);
    await screen.findByText('Hola, Ana Flores');
    expect(api.verify).not.toHaveBeenCalled();
    api.forgetDevice.mockResolvedValueOnce(no('offline'));
    press(account.dashboard.forgetDevice);
    expect(screen.getByText(account.dashboard.forgettingDevice)).toBeTruthy();
    await screen.findByText(account.errors.offline);
    api.forgetDevice.mockResolvedValueOnce(ok(null));
    press(account.dashboard.forgetDevice);
    await screen.findByText(account.dashboard.deviceForgotten);
  });
});

describe('account area · orders (FC 028 F2, T2.6)', () => {
  it('lets staff switch to the panel, filter, page, open an order and come back', async () => {
    api.me.mockResolvedValue(ok(STAFF));
    api.listOrders.mockResolvedValue(
      ok({ items: [SUMMARY], page: 1, pageSize: 20, total: 41 })
    );
    api.readOrder.mockResolvedValue(ok(DETAIL));
    renderApp();
    await screen.findByText('Hola, Luis Staff');
    const tab = screen.getByRole('link', { name: account.dashboard.panel });
    expect(tab.getAttribute('href')).toBe('/cuenta/panel/');
    fireEvent.click(tab);
    expect(globalThis.location.pathname).toBe('/cuenta/panel/');
    await screen.findByLabelText(account.orders.filter);
    fireEvent.change(screen.getByLabelText(account.orders.filter), {
      target: { value: 'PAID' },
    });
    await waitFor(() =>
      expect(api.listOrders).toHaveBeenLastCalledWith('admin', {
        page: 1,
        status: 'PAID',
      })
    );
    await screen.findByText('Página 1 de 3');
    press(account.orders.next);
    await screen.findByText('Página 2 de 3');
    press(account.orders.previous);
    await screen.findByText('Página 1 de 3');
    expect(screen.getByText(account.orders.test)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('link', { name: `Ver detalle del pedido ${ORDER}` })
    );
    expect(globalThis.location.pathname).toBe(`/cuenta/panel/${ORDER}/`);
    await screen.findByText(account.orders.alert);
    expect(api.readOrder).toHaveBeenCalledWith('admin', ORDER);
    expect(screen.getByText(account.orders.expiresAt)).toBeTruthy();
    expect(screen.getByText('PACK')).toBeTruthy();
    expect(screen.getByText(/Sin cambio/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: account.orders.back }));
    expect(globalThis.location.pathname).toBe('/cuenta/panel/');
    fireEvent.click(
      screen.getByRole('link', { name: account.dashboard.orders })
    );
    expect(globalThis.location.pathname).toBe('/cuenta/');
  });

  it('opens the order a link names, and follows the back button', async () => {
    globalThis.history.replaceState(null, '', `/cuenta/${ORDER}/`);
    api.me.mockResolvedValue(ok(BUYER));
    api.readOrder.mockResolvedValue(
      ok({ ...DETAIL, paidAt: SUMMARY.paidAt, paymentEvents: [] })
    );
    renderApp();
    await screen.findByText(account.orders.noPayments);
    expect(api.readOrder).toHaveBeenCalledWith('account', ORDER);
    expect(screen.getByText(account.orders.paidAt)).toBeTruthy();
    act(() => {
      globalThis.history.replaceState(null, '', '/cuenta/');
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText(account.orders.empty);
  });

  it('keeps a buyer out of the panel even when the path names it', async () => {
    globalThis.history.replaceState(null, '', '/cuenta/panel/');
    api.me.mockResolvedValue(ok(BUYER));
    renderApp();
    await screen.findByText(account.orders.empty);
    expect(api.listOrders).toHaveBeenCalledWith('account', {
      page: 1,
      status: '',
    });
  });

  it('says why a list or an order could not be read', async () => {
    api.me.mockResolvedValue(ok(STAFF));
    api.listOrders.mockResolvedValueOnce(no('PERMISSION_DENIED'));
    renderApp();
    await screen.findByText(account.errors.PERMISSION_DENIED);
    cleanup();
    globalThis.history.replaceState(null, '', `/cuenta/${ORDER}/`);
    api.readOrder.mockResolvedValueOnce(no('DATA_DOMAIN_FORBIDDEN'));
    renderApp();
    expect(
      await screen.findByText(account.errors.DATA_DOMAIN_FORBIDDEN)
    ).toBeTruthy();
  });

  it('shows the empty panel, and ignores answers that arrive after leaving', async () => {
    globalThis.history.replaceState(null, '', '/cuenta/panel/');
    api.me.mockResolvedValue(ok(STAFF));
    renderApp();
    await screen.findByText(account.orders.emptyPanel);
    let late!: (value: unknown) => void;
    api.readOrder.mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      }) as never
    );
    let lateList!: (value: unknown) => void;
    api.listOrders.mockReturnValueOnce(
      new Promise((resolve) => {
        lateList = resolve;
      }) as never
    );
    act(() => {
      globalThis.history.replaceState(null, '', `/cuenta/panel/${ORDER}/`);
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
    });
    act(() => {
      globalThis.history.replaceState(null, '', '/cuenta/panel/');
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
    });
    cleanup();
    await act(async () => {
      late(ok(DETAIL));
      lateList(ok({ items: [], page: 1, pageSize: 20, total: 0 }));
    });
    expect(screen.queryByText(account.orders.alert)).toBeNull();
  });

  it('signs out and returns to the sign-in form', async () => {
    globalThis.history.replaceState(null, '', `/cuenta/${ORDER}/`);
    api.me.mockResolvedValue(ok(BUYER));
    api.readOrder.mockResolvedValue(ok(DETAIL));
    api.logout.mockResolvedValue(ok(null));
    renderApp();
    await screen.findByText('Hola, Ana Flores');
    api.me.mockResolvedValue(no('SESSION_INVALID_OR_EXPIRED'));
    press(account.dashboard.signOut);
    expect(screen.getByText(account.dashboard.signingOut)).toBeTruthy();
    await screen.findByRole('heading', { name: account.signIn.title });
    expect(api.logout).toHaveBeenCalled();
    expect(globalThis.location.pathname).toBe('/cuenta/');
  });
});

describe('account page (FC 028 F2)', () => {
  it('prerenders its heading and hydrates with the session', async () => {
    render(<AccountView locale="en" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      getMessages('en').account.title
    );
    await screen.findByRole('heading', {
      name: getMessages('en').account.signIn.title,
    });
  });
});

describe('account area · passwords (FC 042 F2)', () => {
  /** The line of the live list for a text, and whether it reads «met». */
  const line = (text: string) => {
    const item = screen.getByText(text).closest('li');
    return item?.textContent?.startsWith(account.password.met) ?? false;
  };

  it('gives every password field its own eye, which shows and hides it (T1.3, T2.5)', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    const input = screen.getByLabelText(
      account.signIn.password
    ) as HTMLInputElement;
    const eye = screen.getByRole('button', { name: account.password.show });
    expect([input.type, eye.getAttribute('aria-pressed')]).toEqual([
      'password',
      'false',
    ]);
    expect(eye.getAttribute('type')).toBe('button');
    fireEvent.click(eye);
    expect([input.type, eye.getAttribute('aria-pressed')]).toEqual([
      'text',
      'true',
    ]);
    expect(eye.getAttribute('aria-label')).toBe(account.password.hide);
    press(account.password.hide);
    expect(input.type).toBe('password');
    press(account.signIn.toRegister);
    expect(screen.getAllByRole('button', { name: /contraseña/i })).toHaveLength(
      2
    );
    press(account.password.showRepeat);
    expect(
      (screen.getByLabelText(account.register.confirm) as HTMLInputElement).type
    ).toBe('text');
  });

  it('marks each rule met or missing as the person types, in words and with the icon (T1.4)', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    press(account.signIn.toRegister);
    const list = screen
      .getByText(account.password.rulesTitle)
      .closest('[aria-live]');
    expect(list?.getAttribute('aria-live')).toBe('polite');
    expect(line(account.password.rules.length)).toBe(false);
    type(account.register.fullName, 'Ana Flores');
    type(account.register.password, 'Ana-Flores7#Sur');
    expect(
      ['length', 'uppercase', 'lowercase', 'digit', 'symbol', 'personal'].map(
        (rule) =>
          line(
            account.password.rules[rule as keyof typeof account.password.rules]
          )
      )
    ).toEqual([true, true, true, true, true, false]);
    expect(line(account.password.match)).toBe(false);
    type(account.register.confirm, 'Ana-Flores7#Sur');
    expect(line(account.password.match)).toBe(true);
  });

  it('asks for a reset link with the e-mail typed, and answers the same either way (T1.1)', async () => {
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    type(account.signIn.email, 'ana@example.test ');
    press(account.signIn.forgot);
    await screen.findByRole('heading', { name: account.forgot.title });
    expect(
      (screen.getByLabelText(account.forgot.email) as HTMLInputElement).value
    ).toBe('ana@example.test');
    api.forgotPassword.mockResolvedValueOnce(no('rate_limited'));
    press(account.forgot.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.rate_limited
      )
    );
    api.forgotPassword.mockResolvedValueOnce(
      ok({ ok: true, message: 'neutral' })
    );
    press(account.forgot.submit);
    await screen.findByText(account.forgot.sent);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.forgotPassword).toHaveBeenLastCalledWith('ana@example.test');
    type(account.forgot.email, ' ');
    press(account.forgot.submit);
    expect(screen.getByRole('alert').textContent).toBe(account.errors.required);
    press(account.forgot.back);
    await screen.findByRole('heading', { name: account.signIn.title });
  });

  it('opens the reset form from the mailed link, drops the token from the address and sets the password (T1.2)', async () => {
    const token = 'a'.repeat(64);
    globalThis.history.replaceState(
      null,
      '',
      `/cuenta/?action=reset-password&token=${token}`
    );
    renderApp();
    await screen.findByRole('heading', { name: account.reset.title });
    expect(globalThis.location.search).toBe('');
    expect(api.me).not.toHaveBeenCalled();
    // The reset form cannot know the e-mail or name: that rule is left to the API.
    expect(screen.queryByText(account.password.rules.personal)).toBeNull();
    const submit = () =>
      screen.getByRole('button', {
        name: account.reset.submit,
      }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    type(account.reset.password, STRONG);
    type(account.reset.confirm, STRONG);
    api.resetPassword.mockResolvedValueOnce(no('PASSWORD_PERSONAL'));
    press(account.reset.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.PASSWORD_PERSONAL
      )
    );
    expect(screen.queryByText(account.reset.again)).toBeNull();
    api.resetPassword.mockResolvedValueOnce(ok({ ok: true }));
    press(account.reset.submit);
    await screen.findByText(account.reset.done);
    expect(api.resetPassword).toHaveBeenLastCalledWith({
      token,
      password: STRONG,
    });
  });

  it('offers another link when the mailed one expired or was used', async () => {
    globalThis.history.replaceState(
      null,
      '',
      `/cuenta/?action=reset-password&token=${'b'.repeat(64)}`
    );
    renderApp();
    await screen.findByRole('heading', { name: account.reset.title });
    type(account.reset.password, STRONG);
    type(account.reset.confirm, STRONG);
    api.resetPassword.mockResolvedValueOnce(no('RESET_TOKEN_INVALID'));
    press(account.reset.submit);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        account.errors.RESET_TOKEN_INVALID
      )
    );
    press(account.reset.again);
    await screen.findByRole('heading', { name: account.forgot.title });
  });

  it('ignores a malformed reset link and shows the sign-in form', async () => {
    globalThis.history.replaceState(
      null,
      '',
      '/cuenta/?action=reset-password&token=not-a-token'
    );
    renderApp();
    await screen.findByRole('heading', { name: account.signIn.title });
    await waitFor(() => expect(api.me).toHaveBeenCalled());
  });
});
