'use client';

import { type SubmitEvent, useCallback, useEffect, useState } from 'react';
import type { Messages } from '@/app/i18n';
import type { AdminUser } from '@/lib/account/adminUserTypes';
import {
  type AdminUsersFailure,
  inviteAdminUser,
  listAdminUsers,
  updateAdminUser,
} from '@/lib/api/adminUsersClient';
import { fill } from '@/lib/catalog/format';

/** `account.admins` texts. */
export type AdminUsersTexts = Messages['account']['admins'];

/** What the console says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
const FIELD = 'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/** The message of a refusal: the console names each code; anything else is generic. */
function failureText(texts: AdminUsersTexts, reason: AdminUsersFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof AdminUsersTexts['errors']]
    : texts.errors.unknown;
}

/** A text field of the invitation form, trimmed. */
function textOf(form: HTMLFormElement, name: 'email' | 'fullName'): string {
  return (form.elements.namedItem(name) as HTMLInputElement).value.trim();
}

/**
 * The administrators console of `/cuenta/administradores` (FC 044 F2, T1.4): shown only to the
 * owner, and only as a convenience, since the API refuses everyone else. It lists the owner
 * (protected: no control changes it, T2.1) and the administrators, invites a new one by e-mail
 * (the API mails a 15-minute link; no password is ever typed or shown here, T2.2) and switches
 * an administrator on or off or withdraws its role.
 *
 * @param texts - `account.admins` texts.
 */
export function AdminUsersConsole({
  texts,
}: Readonly<{ texts: AdminUsersTexts }>) {
  const [accounts, setAccounts] = useState<AdminUser[] | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listAdminUsers();
    if (result.ok) setAccounts(result.data.items);
    else setNote({ kind: 'error', text: failureText(texts, result.reason) });
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write, then reloads the list and says how it went. */
  async function run(
    write: () => ReturnType<typeof inviteAdminUser>,
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
    const email = textOf(form, 'email');
    const fullName = textOf(form, 'fullName');
    const invited = await run(
      () => inviteAdminUser({ email, fullName }),
      fill(texts.invited, { email })
    );
    if (invited) form.reset();
  }

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
        <AccountTable
          texts={texts}
          accounts={accounts}
          busy={busy}
          onChange={(id, change) =>
            void run(() => updateAdminUser(id, change), texts.saved)
          }
        />
      )}
      <form
        onSubmit={(event) => void invite(event)}
        className="flex max-w-xl flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">{texts.new}</h2>
        <p className="text-sm">{texts.explain}</p>
        <label className="flex flex-col gap-1">
          {texts.name}
          <input
            name="fullName"
            required
            minLength={2}
            maxLength={150}
            autoComplete="off"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          {texts.email}
          <input
            name="email"
            type="email"
            required
            maxLength={255}
            autoComplete="off"
            className={FIELD}
          />
        </label>
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

/** The accounts: the owner without controls, each administrator with its two actions. */
function AccountTable({
  texts,
  accounts,
  busy,
  onChange,
}: Readonly<{
  texts: AdminUsersTexts;
  accounts: AdminUser[];
  busy: boolean;
  onChange: (
    id: string,
    change: { isActive?: boolean; revokeAdmin?: boolean }
  ) => void;
}>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{texts.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{texts.name}</th>
            <th scope="col">{texts.email}</th>
            <th scope="col">{texts.role}</th>
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
            return (
              <tr key={account.id}>
                <td>{account.fullName}</td>
                <td>{account.email}</td>
                <td>{owner ? texts.roleOwner : texts.roleAdmin}</td>
                <td>{account.isActive ? texts.active : texts.inactive}</td>
                <td>
                  {account.totpEnabled ? texts.twoStepOn : texts.twoStepOff}
                </td>
                {owner ? (
                  <td>{texts.protected}</td>
                ) : (
                  <td className="flex gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${toggle}: ${account.fullName}`}
                      onClick={() =>
                        onChange(account.id, { isActive: !account.isActive })
                      }
                      className="tap-target underline"
                    >
                      {toggle}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${texts.revoke}: ${account.fullName}`}
                      onClick={() =>
                        onChange(account.id, { revokeAdmin: true })
                      }
                      className="tap-target underline"
                    >
                      {texts.revoke}
                    </button>
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
