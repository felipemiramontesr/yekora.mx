'use client';

import { useState } from 'react';
import type { RoleView } from '@/lib/account/staffTypes';
import { updateStaffRole } from '@/lib/api/staffClient';
import { failureText, type Note, type UsersTexts } from './usersShared';

/** What a role gains and loses when the matrix is saved. */
interface Change {
  role: RoleView;
  added: string[];
  removed: string[];
  permissions: string[];
}

/** The roles whose permissions the owner has changed, with what they hold now; the rest are as the API says. */
type Edits = Readonly<Record<string, readonly string[]>>;

/** The area of a permission: what comes before the colon. */
const moduleOf = (permission: string) => permission.split(':')[0];

/** The permissions every role keeps, and the one only the owner holds (FC 072 T2.7). */
const ALWAYS = 'account:self';
const OWNER_ONLY = 'roles:manage';
const ADMIN_ONLY = 'users:manage';

/**
 * Whether the matrix lets a cell change (T2.7): never in a role of the system or for a session
 * that is not the owner's, never `account:self` (every role keeps it), never `roles:manage` (the
 * owner alone holds it) and `users:manage` only in the administrator role.
 */
function lockedCell(owner: boolean, role: RoleView, permission: string) {
  return (
    !owner ||
    role.isSystem ||
    permission === ALWAYS ||
    permission === OWNER_ONLY ||
    (permission === ADMIN_ONLY && role.id !== 'admin')
  );
}

/**
 * The «Permisos» tab of the panel of users and roles (FC 072 F3): the matrix of permissions in the
 * style of Drupal, the permissions in rows grouped by area and the roles in columns. The owner
 * ticks and unticks the roles that are not of the system, sees a summary of what each role gains
 * and loses and confirms it; an administrator only reads. The rules of T2.7 are drawn into the
 * matrix (a locked cell cannot change) and the API enforces them anyway.
 *
 * @param texts - `account.users` texts.
 * @param owner - Whether the session is the owner's.
 * @param roles - The roles, with their permissions.
 * @param catalog - Every permission the matrix is made of.
 * @param onChanged - Reloads the roles after a save.
 */
export function AccountMatrixPanel({
  texts,
  owner,
  roles,
  catalog,
  onChanged,
}: Readonly<{
  texts: UsersTexts;
  owner: boolean;
  roles: readonly RoleView[];
  catalog: readonly string[];
  onChanged: () => Promise<void>;
}>) {
  const t = texts.matrixTab;
  const [edits, setEdits] = useState<Edits>({});
  const [note, setNote] = useState<Note>(null);
  const [confirming, setConfirming] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState(false);

  /** What a role holds in the matrix now: what the owner set, or what the API says. */
  const heldBy = (role: RoleView) => edits[role.id] ?? role.permissions;

  const names = t.names as Record<string, string>;
  const modules = t.modules as Record<string, string>;
  const label = (permission: string) => names[permission] ?? permission;

  function toggle(role: RoleView, permission: string) {
    const held = heldBy(role);
    setEdits({
      ...edits,
      [role.id]: held.includes(permission)
        ? held.filter((item) => item !== permission)
        : [...held, permission],
    });
    setNote(null);
  }

  /** What the owner changed, role by role. */
  function changes(): Change[] {
    return roles
      .filter((role) => !role.isSystem)
      .map((role) => {
        const now = heldBy(role);
        return {
          role,
          added: now.filter((item) => !role.permissions.includes(item)),
          removed: role.permissions.filter((item) => !now.includes(item)),
          permissions: [...now].sort((first, second) =>
            first.localeCompare(second)
          ),
        };
      })
      .filter((change) => change.added.length + change.removed.length > 0);
  }

  function review() {
    const pending = changes();
    if (pending.length === 0) {
      setNote({ kind: 'ok', text: t.noChanges });
      return;
    }
    setConfirming(pending);
  }

  async function save(pending: Change[]) {
    setBusy(true);
    const results = await Promise.all(
      pending.map((change) =>
        updateStaffRole(change.role.id, { permissions: change.permissions })
      )
    );
    setBusy(false);
    const failed = results.find((result) => !result.ok);
    setConfirming(null);
    setEdits({});
    if (failed && !failed.ok) {
      setNote({ kind: 'error', text: failureText(texts, failed.reason) });
    } else {
      setNote({ kind: 'ok', text: t.saved });
    }
    await onChanged();
  }

  if (confirming) {
    return (
      <section className="flex max-w-2xl flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.summaryTitle}</h2>
        <p className="text-sm">{t.summaryIntro}</p>
        {confirming.map((change) => (
          <div key={change.role.id}>
            <h3 className="font-medium">{change.role.name}</h3>
            <ul className="list-disc pl-6 text-sm">
              {change.added.map((permission) => (
                <li key={`+${permission}`}>
                  {t.added}: {label(permission)}
                </li>
              ))}
              {change.removed.map((permission) => (
                <li key={`-${permission}`}>
                  {t.removed}: {label(permission)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <span className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(confirming)}
            className="tap-target rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
          >
            {busy ? t.saving : t.confirm}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(null)}
            className="tap-target underline"
          >
            {t.back}
          </button>
        </span>
      </section>
    );
  }

  const areas = [...new Set(catalog.map(moduleOf))];
  return (
    <section className="flex flex-col gap-4">
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {!owner && <p className="text-sm">{t.readOnly}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.permission}</th>
              {roles.map((role) => (
                <th key={role.id} scope="col">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          {areas.map((area) => (
            <tbody key={area}>
              <tr>
                <th scope="rowgroup" colSpan={roles.length + 1}>
                  {modules[area] ?? area}
                </th>
              </tr>
              {catalog
                .filter((permission) => moduleOf(permission) === area)
                .map((permission) => (
                  <tr key={permission}>
                    <th scope="row" className="font-normal">
                      {label(permission)}
                    </th>
                    {roles.map((role) => (
                      <td key={role.id}>
                        <input
                          type="checkbox"
                          aria-label={`${label(permission)}: ${role.name}`}
                          checked={heldBy(role).includes(permission)}
                          disabled={lockedCell(owner, role, permission)}
                          onChange={() => toggle(role, permission)}
                          className="size-5 accent-petroleo"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      {owner && (
        <span className="flex gap-3">
          <button
            type="button"
            onClick={review}
            className="tap-target rounded-lg bg-petroleo px-5 font-semibold text-marfil"
          >
            {t.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setEdits({});
              setNote(null);
            }}
            className="tap-target underline"
          >
            {t.reset}
          </button>
        </span>
      )}
    </section>
  );
}
