'use client';

import { type SubmitEvent, useState } from 'react';
import type { RoleView } from '@/lib/account/staffTypes';
import { createStaffRole, updateStaffRole } from '@/lib/api/staffClient';
import { fill } from '@/lib/catalog/format';
import { Field } from '../ui/Field';
import { FIELD, failureText, type Note, type UsersTexts } from './usersShared';

/** The permissions each quick template starts a role with; the owner then edits them in the matrix. */
const TEMPLATES = {
  customer_care: [
    'account:self',
    'orders:read',
    'returns:prepare',
    'returns:view',
  ],
  warehouse: ['account:self', 'orders:manage', 'orders:read'],
  accountant: ['account:self', 'audit:read', 'orders:read'],
} as const;

/** One of the keys of {@link TEMPLATES}. */
type TemplateKey = keyof typeof TEMPLATES;

/** What the form of a new role holds. */
interface Draft {
  id: string;
  name: string;
  description: string;
  assignable: boolean;
  permissions: readonly string[];
}

const EMPTY: Draft = {
  id: '',
  name: '',
  description: '',
  assignable: true,
  permissions: ['account:self'],
};

/**
 * The «Roles» tab of the panel of users and roles (FC 072 F3): the roles of the store, and for the
 * owner a form to create a role of support, starting from a quick template or from nothing. An
 * administrator reads the roles and cannot change them; the API decides anyway (T1.2). The
 * permissions of a role are chosen afterwards in the matrix.
 *
 * @param texts - `account.users` texts.
 * @param owner - Whether the session is the owner's.
 * @param roles - The roles, with their permissions.
 * @param onChanged - Reloads the roles after a write.
 */
export function AccountRolesPanel({
  texts,
  owner,
  roles,
  onChanged,
}: Readonly<{
  texts: UsersTexts;
  owner: boolean;
  roles: readonly RoleView[];
  onChanged: () => Promise<void>;
}>) {
  const t = texts.rolesTab;
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  /** Runs one write, then reloads the roles and says how it went. */
  async function run(
    write: () => ReturnType<typeof createStaffRole>,
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
    await onChanged();
    return true;
  }

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await run(
      () =>
        createStaffRole({
          id: draft.id.trim(),
          name: draft.name.trim(),
          ...(draft.description.trim() && {
            description: draft.description.trim(),
          }),
          permissions: [...draft.permissions],
          assignableByAdmin: draft.assignable,
        }),
      fill(t.created, { name: draft.name.trim() })
    );
    if (created) setDraft(EMPTY);
  }

  function startFrom(key: TemplateKey) {
    const template = t.templateList[key];
    setDraft({
      id: key,
      name: template.name,
      description: template.description,
      assignable: true,
      permissions: TEMPLATES[key],
    });
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
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.name}</th>
              <th scope="col">{t.slug}</th>
              <th scope="col">{t.description}</th>
              <th scope="col">{t.state}</th>
              <th scope="col">{t.givenBy}</th>
              <th scope="col">{t.permissions}</th>
              {owner && <th scope="col">{t.actions}</th>}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>{role.id}</td>
                <td>{role.description ?? ''}</td>
                <td>{role.isActive ? t.active : t.inactive}</td>
                <td>{role.assignableByAdmin ? t.adminToo : t.ownerOnly}</td>
                <td>{role.permissions.length}</td>
                {owner && (
                  <td>
                    {role.isSystem ? (
                      t.system
                    ) : (
                      <RoleActions
                        texts={t}
                        role={role}
                        busy={busy}
                        onChange={(change) =>
                          run(() => updateStaffRole(role.id, change), t.saved)
                        }
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner ? (
        <form
          onSubmit={(event) => void create(event)}
          className="flex max-w-xl flex-col gap-3"
        >
          <h2 className="text-lg font-semibold">{t.new}</h2>
          <p className="text-sm">{t.explain}</p>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="font-medium">{t.templates}</legend>
            {(Object.keys(TEMPLATES) as TemplateKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => startFrom(key)}
                className="tap-target rounded-lg border border-petroleo/40 px-4"
              >
                {t.templateList[key].name}
              </button>
            ))}
          </fieldset>
          <Field
            id="role-slug"
            label={t.fieldSlug}
            description={t.slugHelp}
            example={t.slugExample}
            exampleLabel={texts.exampleLabel}
          >
            {(control) => (
              <input
                {...control}
                required
                pattern="[a-z][a-z0-9_]{2,30}"
                value={draft.id}
                onChange={(event) =>
                  setDraft({ ...draft, id: event.target.value })
                }
                autoComplete="off"
                className={FIELD}
              />
            )}
          </Field>
          <Field
            id="role-name"
            label={t.fieldName}
            description={t.nameHelp}
            example={t.nameExample}
            exampleLabel={texts.exampleLabel}
          >
            {(control) => (
              <input
                {...control}
                required
                minLength={2}
                maxLength={100}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                autoComplete="off"
                className={FIELD}
              />
            )}
          </Field>
          <Field
            id="role-description"
            label={t.fieldDescription}
            description={t.descriptionHelp}
            example={t.descriptionExample}
            exampleLabel={texts.exampleLabel}
          >
            {(control) => (
              <input
                {...control}
                maxLength={500}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                autoComplete="off"
                className={FIELD}
              />
            )}
          </Field>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.assignable}
              onChange={(event) =>
                setDraft({ ...draft, assignable: event.target.checked })
              }
              className="size-5 accent-petroleo"
            />
            {t.assignable}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
          >
            {busy ? t.creating : t.create}
          </button>
        </form>
      ) : (
        <p className="text-sm">{t.readOnly}</p>
      )}
    </section>
  );
}

/** The two actions of a role that is not of the system; the administrator role keeps its own rules. */
function RoleActions({
  texts,
  role,
  busy,
  onChange,
}: Readonly<{
  texts: UsersTexts['rolesTab'];
  role: RoleView;
  busy: boolean;
  onChange: (change: {
    isActive?: boolean;
    assignableByAdmin?: boolean;
  }) => Promise<boolean>;
}>) {
  if (role.id === 'admin') return null;
  const toggle = role.isActive ? texts.deactivate : texts.activate;
  const gift = role.assignableByAdmin ? texts.denyAdmin : texts.allowAdmin;
  return (
    <span className="flex gap-3">
      <button
        type="button"
        disabled={busy}
        aria-label={`${toggle}: ${role.name}`}
        onClick={() => void onChange({ isActive: !role.isActive })}
        className="tap-target underline"
      >
        {toggle}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`${gift}: ${role.name}`}
        onClick={() =>
          void onChange({ assignableByAdmin: !role.assignableByAdmin })
        }
        className="tap-target underline"
      >
        {gift}
      </button>
    </span>
  );
}
