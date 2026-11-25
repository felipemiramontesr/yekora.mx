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
import type { RoleView } from '@/lib/account/staffTypes';
import {
  createStaffRole,
  listStaffRoles,
  listStaffUsers,
  updateStaffRole,
} from '@/lib/api/staffClient';
import { AccountUsersConsole } from './AccountUsersConsole';

vi.mock('@/lib/api/staffClient', () => ({
  listStaffUsers: vi.fn(),
  listStaffRoles: vi.fn(),
  inviteStaffUser: vi.fn(),
  updateStaffUser: vi.fn(),
  createStaffRole: vi.fn(),
  updateStaffRole: vi.fn(),
}));

const api = {
  users: vi.mocked(listStaffUsers),
  roles: vi.mocked(listStaffRoles),
  create: vi.mocked(createStaffRole),
  update: vi.mocked(updateStaffRole),
};

const texts = getMessages('es-MX').account.users;
const t = texts.rolesTab;
const m = texts.matrixTab;

const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const role = (
  id: string,
  name: string,
  over: Partial<RoleView> = {}
): RoleView => ({
  id,
  name,
  description: null,
  isActive: true,
  isSystem: false,
  assignableByAdmin: true,
  permissions: ['account:self'],
  ...over,
});

const CATALOG = [
  'account:self',
  'orders:manage',
  'orders:read',
  'roles:manage',
  'users:manage',
  'ghost:power',
];
const ROLES: RoleView[] = [
  role('owner', 'Dueño', {
    isSystem: true,
    assignableByAdmin: false,
    permissions: [
      'account:self',
      'orders:read',
      'roles:manage',
      'users:manage',
    ],
  }),
  role('admin', 'Administrador', {
    assignableByAdmin: false,
    permissions: ['account:self', 'orders:read', 'users:manage'],
  }),
  role('staff_orders', 'Vendedor', {
    description: 'Mostrador',
    permissions: ['account:self', 'orders:manage', 'orders:read'],
  }),
  role('retired', 'Retirado', { isActive: false, assignableByAdmin: false }),
];

/** Opens the console on a tab, with the roles listed. */
async function open(owner: boolean, tab?: string) {
  api.users.mockResolvedValue(ok({ items: [] }));
  // Each read of the API answers with new objects, as a real answer does.
  api.roles.mockImplementation(async () =>
    ok({ items: ROLES.map((item) => ({ ...item })), catalog: CATALOG })
  );
  render(<AccountUsersConsole texts={texts} owner={owner} />);
  await screen.findByText(texts.caption);
  if (tab) fireEvent.click(screen.getByRole('tab', { name: tab }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the tabs of the panel of users and roles (FC 072 F3)', () => {
  it('opens on the staff and moves between the three tabs, each tab labelled by its panel', async () => {
    await open(true);
    expect(
      screen
        .getByRole('tab', { name: texts.tabs.staff })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: texts.tabs.roles }));
    expect(screen.getByRole('table', { name: t.caption })).toBeTruthy();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      'users-tab-roles'
    );
    fireEvent.click(screen.getByRole('tab', { name: texts.tabs.matrix }));
    expect(screen.getByRole('table', { name: m.caption })).toBeTruthy();
  });

  it('keeps the tabs usable when the roles cannot be read: the roles tab is empty', async () => {
    api.users.mockResolvedValue(ok({ items: [] }));
    api.roles.mockResolvedValue(no('unknown'));
    render(<AccountUsersConsole texts={texts} owner />);
    await screen.findByText(texts.caption);
    fireEvent.click(screen.getByRole('tab', { name: texts.tabs.roles }));
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});

describe('the roles tab', () => {
  it('lists the roles for the owner, with who gives each, its permissions and its actions; the system role has none', async () => {
    await open(true, texts.tabs.roles);
    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows[1]).toContain('Dueñoowner');
    expect(rows[1]).toContain(t.system);
    expect(rows[2]).toContain('Administradoradmin');
    for (const text of [
      'Vendedor',
      'staff_orders',
      'Mostrador',
      t.active,
      t.adminToo,
    ]) {
      expect(rows[3]).toContain(text);
    }
    expect(rows[4]).toContain(`${t.inactive}${t.ownerOnly}`);
    expect(
      screen.queryByRole('button', { name: `${t.deactivate}: Administrador` })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: `${t.deactivate}: Vendedor` })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${t.activate}: Retirado` })
    ).toBeTruthy();
  });

  it('shows an administrator the roles and no control to change them', async () => {
    await open(false, texts.tabs.roles);
    expect(screen.queryByRole('columnheader', { name: t.actions })).toBeNull();
    expect(
      screen.queryByRole('button', { name: new RegExp(t.deactivate) })
    ).toBeNull();
    expect(screen.getByText(t.readOnly)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: t.new })).toBeNull();
  });

  it('switches a role off and on, and lets the administrators give it or not', async () => {
    await open(true, texts.tabs.roles);
    api.update.mockResolvedValue(ok(ROLES[2]));
    fireEvent.click(
      screen.getByRole('button', { name: `${t.deactivate}: Vendedor` })
    );
    await screen.findByText(t.saved);
    expect(api.update).toHaveBeenLastCalledWith('staff_orders', {
      isActive: false,
    });
    fireEvent.click(
      screen.getByRole('button', { name: `${t.denyAdmin}: Vendedor` })
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith('staff_orders', {
        assignableByAdmin: false,
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${t.allowAdmin}: Retirado` })
    );
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith('retired', {
        assignableByAdmin: true,
      })
    );
    await waitFor(() => expect(api.roles).toHaveBeenCalledTimes(4));
  });

  it('names the refusal of a change', async () => {
    await open(true, texts.tabs.roles);
    api.update.mockResolvedValue(no('SYSTEM_ROLE_PROTECTED'));
    fireEvent.click(
      screen.getByRole('button', { name: `${t.deactivate}: Vendedor` })
    );
    expect(
      await screen.findByText(texts.errors.SYSTEM_ROLE_PROTECTED)
    ).toBeTruthy();
  });

  it('creates a role from a quick template, and clears the form', async () => {
    await open(true, texts.tabs.roles);
    fireEvent.click(
      screen.getByRole('button', { name: t.templateList.warehouse.name })
    );
    expect((screen.getByLabelText(t.fieldSlug) as HTMLInputElement).value).toBe(
      'warehouse'
    );
    expect((screen.getByLabelText(t.fieldName) as HTMLInputElement).value).toBe(
      t.templateList.warehouse.name
    );
    api.create.mockResolvedValue(ok(ROLES[2]));
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await screen.findByText(
      `Listo. Creamos el rol ${t.templateList.warehouse.name}.`
    );
    expect(api.create).toHaveBeenCalledWith({
      id: 'warehouse',
      name: t.templateList.warehouse.name,
      description: t.templateList.warehouse.description,
      permissions: ['account:self', 'orders:manage', 'orders:read'],
      assignableByAdmin: true,
    });
    expect((screen.getByLabelText(t.fieldSlug) as HTMLInputElement).value).toBe(
      ''
    );
  });

  it.each(['customer_care', 'accountant'] as const)(
    'fills the form from the %s template',
    async (key) => {
      await open(true, texts.tabs.roles);
      fireEvent.click(
        screen.getByRole('button', { name: t.templateList[key].name })
      );
      expect(
        (screen.getByLabelText(t.fieldSlug) as HTMLInputElement).value
      ).toBe(key);
    }
  );

  it('creates a role from nothing: only what was typed, with no description when it is empty, and a role the administrators may not give', async () => {
    await open(true, texts.tabs.roles);
    fireEvent.change(screen.getByLabelText(t.fieldSlug), {
      target: { value: 'bodega' },
    });
    fireEvent.change(screen.getByLabelText(t.fieldName), {
      target: { value: 'Bodega' },
    });
    fireEvent.click(screen.getByLabelText(t.assignable));
    api.create.mockResolvedValue(ok(ROLES[2]));
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    expect(screen.getByRole('button', { name: t.creating })).toBeTruthy();
    await screen.findByText('Listo. Creamos el rol Bodega.');
    expect(api.create).toHaveBeenCalledWith({
      id: 'bodega',
      name: 'Bodega',
      permissions: ['account:self'],
      assignableByAdmin: false,
    });
  });

  it('keeps what was typed and names the refusal when the role is refused', async () => {
    await open(true, texts.tabs.roles);
    fireEvent.change(screen.getByLabelText(t.fieldSlug), {
      target: { value: 'bodega' },
    });
    fireEvent.change(screen.getByLabelText(t.fieldName), {
      target: { value: 'Bodega' },
    });
    fireEvent.change(screen.getByLabelText(t.fieldDescription), {
      target: { value: 'Almacén' },
    });
    api.create.mockResolvedValue(no('ROLE_ID_RESERVED'));
    fireEvent.click(screen.getByRole('button', { name: t.create }));
    await screen.findByText(texts.errors.ROLE_ID_RESERVED);
    expect((screen.getByLabelText(t.fieldSlug) as HTMLInputElement).value).toBe(
      'bodega'
    );
    expect(
      (screen.getByLabelText(t.fieldDescription) as HTMLInputElement).value
    ).toBe('Almacén');
  });
});

describe('the matrix tab', () => {
  const cell = (permission: string, name: string) =>
    screen.getByRole('checkbox', {
      name: `${(m.names as Record<string, string>)[permission] ?? permission}: ${name}`,
    }) as HTMLInputElement;

  it('draws the permissions grouped by area and the roles in columns, with the rules of T2.7 locked into it', async () => {
    await open(true, texts.tabs.matrix);
    expect(screen.getByRole('columnheader', { name: 'Vendedor' })).toBeTruthy();
    expect(screen.getByText(m.modules.orders)).toBeTruthy();
    expect(screen.getByText('ghost')).toBeTruthy();
    expect(screen.getByText('ghost:power')).toBeTruthy();
    // A role of the system, account:self, roles:manage and users:manage outside the administrator are locked.
    expect(cell('orders:read', 'Dueño').disabled).toBe(true);
    expect(cell('account:self', 'Vendedor').disabled).toBe(true);
    expect(cell('account:self', 'Vendedor').checked).toBe(true);
    expect(cell('roles:manage', 'Vendedor').disabled).toBe(true);
    expect(cell('users:manage', 'Vendedor').disabled).toBe(true);
    expect(cell('users:manage', 'Administrador').disabled).toBe(false);
    expect(cell('orders:manage', 'Vendedor').disabled).toBe(false);
    expect(cell('orders:manage', 'Vendedor').checked).toBe(true);
    expect(cell('orders:manage', 'Administrador').checked).toBe(false);
  });

  it('shows an administrator the matrix and no button to change it', async () => {
    await open(false, texts.tabs.matrix);
    expect(screen.getByText(m.readOnly)).toBeTruthy();
    expect(cell('orders:manage', 'Vendedor').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: m.save })).toBeNull();
  });

  it('says there is nothing to save when nothing changed', async () => {
    await open(true, texts.tabs.matrix);
    fireEvent.click(screen.getByRole('button', { name: m.save }));
    expect(screen.getByText(m.noChanges)).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('shows what each role gains and loses, and saves only after the owner confirms', async () => {
    await open(true, texts.tabs.matrix);
    fireEvent.click(cell('orders:manage', 'Vendedor'));
    fireEvent.click(cell('orders:manage', 'Administrador'));
    fireEvent.click(screen.getByRole('button', { name: m.save }));
    expect(screen.getByRole('heading', { name: m.summaryTitle })).toBeTruthy();
    expect(
      screen.getByText(`${m.removed}: Preparar, enviar y entregar pedidos`)
    ).toBeTruthy();
    expect(
      screen.getByText(`${m.added}: Preparar, enviar y entregar pedidos`)
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
    api.update.mockResolvedValue(ok(ROLES[2]));
    fireEvent.click(screen.getByRole('button', { name: m.confirm }));
    await screen.findByText(m.saved);
    expect(api.update).toHaveBeenCalledWith('staff_orders', {
      permissions: ['account:self', 'orders:read'],
    });
    expect(api.update).toHaveBeenCalledWith('admin', {
      permissions: [
        'account:self',
        'orders:manage',
        'orders:read',
        'users:manage',
      ],
    });
    expect(api.update).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.roles).toHaveBeenCalledTimes(2));
  });

  it('goes back from the summary without saving, and starts again when the changes are discarded', async () => {
    await open(true, texts.tabs.matrix);
    fireEvent.click(cell('orders:manage', 'Vendedor'));
    fireEvent.click(screen.getByRole('button', { name: m.save }));
    fireEvent.click(screen.getByRole('button', { name: m.back }));
    expect(cell('orders:manage', 'Vendedor').checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: m.reset }));
    expect(cell('orders:manage', 'Vendedor').checked).toBe(true);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('names the refusal when a save is refused, and reloads the roles as the API holds them', async () => {
    await open(true, texts.tabs.matrix);
    fireEvent.click(cell('orders:manage', 'Vendedor'));
    fireEvent.click(screen.getByRole('button', { name: m.save }));
    api.update.mockResolvedValue(no('MATRIX_INVARIANT_VIOLATED'));
    fireEvent.click(screen.getByRole('button', { name: m.confirm }));
    expect(
      await screen.findByText(texts.errors.MATRIX_INVARIANT_VIOLATED)
    ).toBeTruthy();
    await waitFor(() => expect(api.roles).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(cell('orders:manage', 'Vendedor').checked).toBe(true)
    );
  });

  it('shows the busy label while the changes are being saved', async () => {
    await open(true, texts.tabs.matrix);
    fireEvent.click(cell('orders:manage', 'Vendedor'));
    fireEvent.click(screen.getByRole('button', { name: m.save }));
    let finish!: (value: unknown) => void;
    api.update.mockReturnValue(
      new Promise((resolve) => (finish = resolve)) as never
    );
    fireEvent.click(screen.getByRole('button', { name: m.confirm }));
    expect(screen.getByRole('button', { name: m.saving })).toBeTruthy();
    finish(ok(ROLES[2]));
    await screen.findByText(m.saved);
  });

  it('labels a permission the texts do not know by its slug', async () => {
    await open(true, texts.tabs.matrix);
    expect(
      within(screen.getByRole('table', { name: m.caption })).getByText(
        'ghost:power'
      )
    ).toBeTruthy();
  });
});
