'use client';

import { type SubmitEvent, useCallback, useEffect, useState } from 'react';
import type { Messages } from '@/app/i18n';
import type { AdminUser } from '@/lib/account/adminUserTypes';
import type { RoleView } from '@/lib/account/staffTypes';
import {
  inviteStaffUser,
  listStaffRoles,
  listStaffUsers,
  type StaffFailure,
  updateStaffUser,
} from '@/lib/api/staffClient';
import { fill } from '@/lib/catalog/format';
import { Field } from '../ui/Field';

/** `account.users` texts. */
export type UsersTexts = Messages['account']['users'];

/** What the console says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
const FIELD = 'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/** The roles an account of the staff never receives through this panel. */
const OUT_OF_BAND = new Set(['owner', 'customer']);

/** The message of a refusal: the console names each code; anything else is generic. */
function failureText(texts: UsersTexts, reason: StaffFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof UsersTexts['errors']]
    : texts.errors.unknown;
}

/** The roles the session may give: the owner any but its own and the buyer's, an administrator those marked for it. */
function grantableRoles(roles: readonly RoleView[], owner: boolean) {
  return roles.filter(
    (role) =>
      role.isActive &&
      !OUT_OF_BAND.has(role.id) &&
      (owner || role.assignableByAdmin)
  );
}

/**
 * The panel of users and roles of `/cuenta/usuarios` (FC 072 F2): its first tab, the staff. It is
 * shown to the owner and to an administrator, and only as a convenience, since the API decides by
 * the hierarchy. It lists the staff the session may see (the owner protected: no control changes
 * it, T2.1), brings a person in by e-mail with its roles (the API mails a 15-minute link; no
 * password is ever typed or shown here, T2.4) and switches an account on or off or changes its roles.
 *
 * @param texts - `account.users` texts.
 * @param owner - Whether the session is the owner's: it may give every role of support and the administrator.
 */
export function AccountUsersConsole({
  texts,
  owner,
}: Readonly<{ texts: UsersTexts; owner: boolean }>) {
  const [accounts, setAccounts] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [people, catalog] = await Promise.all([
      listStaffUsers(),
      listStaffRoles(),
    ]);
    if (!people.ok) {
      setNote({ kind: 'error', text: failureText(texts, people.reason) });
      return;
    }
    setAccounts(people.data.items);
    if (catalog.ok) setRoles(catalog.data.items);
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write, then reloads the list and says how it went. */
  async function run(
    write: () => ReturnType<typeof inviteStaffUser>,
    done: string
  ) {
    setBusy(true);
    const result = await write();
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return false;
    }
    setNote({ kind: 'ok', text: done });
    await load();
    return true;
  }

  async function invite(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email')).trim();
    const fullName = String(data.get('fullName')).trim();
    const chosen = data.getAll('roles').map(String);
    if (chosen.length === 0) {
      setNote({ kind: 'error', text: texts.noRoles });
      return;
    }
    const invited = await run(
      () => inviteStaffUser({ email, fullName, roles: chosen }),
      fill(texts.invited, { email })
    );
    if (invited) form.reset();
  }

  const names = new Map(roles.map((role) => [role.id, role.name]));
  const grantable = grantableRoles(roles, owner);

  return (
    <section className="flex flex-col gap-6">
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {accounts === null ? (
        <output className="block">{texts.loading}</output>
      ) : (
        <StaffTable
          texts={texts}
          accounts={accounts}
          names={names}
          grantable={grantable}
          busy={busy}
          onChange={(id, change) =>
            run(() => updateStaffUser(id, change), texts.saved)
          }
        />
      )}
      <form
        onSubmit={(event) => void invite(event)}
        className="flex max-w-xl flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">{texts.new}</h2>
        <p className="text-sm">{texts.explain}</p>
        <Field
          id="staff-fullName"
          label={texts.name}
          description={texts.fields.name.description}
          example={texts.fields.name.example}
          exampleLabel={texts.exampleLabel}
        >
          {(control) => (
            <input
              {...control}
              name="fullName"
              required
              minLength={2}
              maxLength={150}
              autoComplete="off"
              className={FIELD}
            />
          )}
        </Field>
        <Field
          id="staff-email"
          label={texts.email}
          description={texts.fields.email.description}
          example={texts.fields.email.example}
          exampleLabel={texts.exampleLabel}
        >
          {(control) => (
            <input
              {...control}
              name="email"
              type="email"
              required
              maxLength={255}
              autoComplete="off"
              className={FIELD}
            />
          )}
        </Field>
        <RoleChoices legend={texts.rolesField} roles={grantable} chosen={[]} />
        <button
          type="submit"
          disabled={busy}
          className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? texts.inviting : texts.invite}
        </button>
      </form>
    </section>
  );
}

/** A group of checkboxes, one for each role that may be given; `chosen` are the ones already held. */
function RoleChoices({
  legend,
  roles,
  chosen,
}: Readonly<{
  legend: string;
  roles: readonly RoleView[];
  chosen: readonly string[];
}>) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-medium">{legend}</legend>
      {roles.map((role) => (
        <label key={role.id} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="roles"
            value={role.id}
            defaultChecked={chosen.includes(role.id)}
            className="size-5 accent-petroleo"
          />
          {role.name}
        </label>
      ))}
    </fieldset>
  );
}

/** The accounts: the owner without controls, each of the others with its actions. */
function StaffTable({
  texts,
  accounts,
  names,
  grantable,
  busy,
  onChange,
}: Readonly<{
  texts: UsersTexts;
  accounts: AdminUser[];
  names: ReadonlyMap<string, string>;
  grantable: readonly RoleView[];
  busy: boolean;
  onChange: (
    id: string,
    change: { isActive?: boolean; roles?: string[] }
  ) => Promise<boolean>;
}>) {
  const [editing, setEditing] = useState<string | null>(null);

  async function saveRoles(
    event: SubmitEvent<HTMLFormElement>,
    account: AdminUser
  ) {
    event.preventDefault();
    const chosen = new FormData(event.currentTarget)
      .getAll('roles')
      .map(String);
    if (chosen.length === 0) return;
    if (await onChange(account.id, { roles: chosen })) setEditing(null);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{texts.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{texts.name}</th>
            <th scope="col">{texts.email}</th>
            <th scope="col">{texts.roles}</th>
            <th scope="col">{texts.status}</th>
            <th scope="col">{texts.twoStep}</th>
            <th scope="col">{texts.actions}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const owner = account.roles.includes('owner');
            // Each control names its account: several rows carry the same two actions.
            const toggle = account.isActive ? texts.deactivate : texts.activate;
            const held = account.roles.filter((role) => role !== 'customer');
            return (
              <tr key={account.id}>
                <td>{account.fullName}</td>
                <td>{account.email}</td>
                <td>
                  {held.map((role) => names.get(role) ?? role).join(', ')}
                </td>
                <td>{account.isActive ? texts.active : texts.inactive}</td>
                <td>
                  {account.totpEnabled ? texts.twoStepOn : texts.twoStepOff}
                </td>
                {owner ? (
                  <td>{texts.protected}</td>
                ) : (
                  <td className="flex flex-col gap-2">
                    <span className="flex gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`${toggle}: ${account.fullName}`}
                        onClick={() =>
                          void onChange(account.id, {
                            isActive: !account.isActive,
                          })
                        }
                        className="tap-target underline"
                      >
                        {toggle}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`${texts.changeRoles}: ${account.fullName}`}
                        onClick={() => setEditing(account.id)}
                        className="tap-target underline"
                      >
                        {texts.changeRoles}
                      </button>
                    </span>
                    {editing === account.id && (
                      <form
                        onSubmit={(event) => void saveRoles(event, account)}
                        className="flex flex-col gap-2"
                      >
                        <RoleChoices
                          legend={fill(texts.rolesLegend, {
                            name: account.fullName,
                          })}
                          roles={grantable}
                          chosen={held}
                        />
                        <span className="flex gap-3">
                          <button
                            type="submit"
                            disabled={busy}
                            className="tap-target underline"
                          >
                            {texts.saveRoles}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="tap-target underline"
                          >
                            {texts.cancel}
                          </button>
                        </span>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
