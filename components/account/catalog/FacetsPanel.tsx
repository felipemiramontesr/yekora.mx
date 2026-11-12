'use client';

import { type SubmitEvent, useCallback, useEffect, useState } from 'react';
import {
  type CatalogFailure,
  createFacetGroup,
  createFacetValue,
  type FacetGroup,
  listFacets,
  updateFacetGroup,
  updateFacetValue,
} from '@/lib/api/catalogAdminClient';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';
import { FIELD, type Note, textOf } from './formHelpers';

/** `account.catalog.facets` texts. */
type Texts = CatalogTexts['facets'];

/** A write that either worked or says why not. */
type Outcome = { ok: true } | { ok: false; reason: CatalogFailure };

/** The yes/no flags of a group: its field name, the text key that names it, and its default. */
const FLAGS = [
  ['isRequired', 'required', false],
  ['isOrdered', 'ordered', false],
  ['isFilterable', 'filterable', true],
  ['showOnLanding', 'landing', false],
] as const;

/** What a group form carries besides the code, read from its fields. */
function groupFieldsOf(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    nameEs: textOf(data, 'nameEs'),
    nameEn: textOf(data, 'nameEn'),
    sortOrder: Number(textOf(data, 'sortOrder')),
    isRequired: data.has('isRequired'),
    isOrdered: data.has('isOrdered'),
    isFilterable: data.has('isFilterable'),
    showOnLanding: data.has('showOnLanding'),
  };
}

/** What a value form carries besides the code, read from its fields. */
function valueFieldsOf(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    valueEs: textOf(data, 'valueEs'),
    valueEn: textOf(data, 'valueEn'),
    sortOrder: Number(textOf(data, 'sortOrder')),
  };
}

/**
 * Facet groups of the catalog (FC 029 F2b, F3): every group, active or retired, with its values;
 * a form to create a group; per group, editing its names, flags and order and retiring or
 * reactivating it; per value, relabelling it and adding new ones. The code of a group or a value
 * is fixed once created, because published pages may name it. The system group Nivel can be
 * renamed and reordered but never retired, and its values are not added or edited (T2.1b).
 *
 * @param texts - `account.catalog` texts.
 */
export function FacetsPanel({ texts }: Readonly<{ texts: CatalogTexts }>) {
  const t = texts.facets;
  const [groups, setGroups] = useState<FacetGroup[] | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listFacets();
    if (result.ok) setGroups(result.data);
    else
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write, then reloads the list and says how it went. */
  async function run(write: () => Promise<Outcome>, done: string) {
    setBusy(true);
    const result = await write();
    setBusy(false);
    if (!result.ok) {
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
      return false;
    }
    setNote({ kind: 'ok', text: done });
    setEditingGroup(null);
    setEditingValue(null);
    await load();
    return true;
  }

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = textOf(new FormData(form), 'code');
    const created = await run(
      () => createFacetGroup({ code, ...groupFieldsOf(form) }),
      t.groupCreated
    );
    if (created) form.reset();
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
      {groups === null && <output className="block">{texts.loading}</output>}
      {groups?.length === 0 && <p>{t.empty}</p>}
      {groups?.map((group) => (
        <GroupCard
          key={group.id}
          texts={t}
          group={group}
          busy={busy}
          editingGroup={editingGroup === group.id}
          editingValue={editingValue}
          onEditGroup={setEditingGroup}
          onEditValue={setEditingValue}
          onSaveGroup={(event) => {
            event.preventDefault();
            void run(
              () =>
                updateFacetGroup(group.id, groupFieldsOf(event.currentTarget)),
              t.saved
            );
          }}
          onToggle={() =>
            void run(
              () => updateFacetGroup(group.id, { isActive: !group.isActive }),
              t.saved
            )
          }
          onSaveValue={(event, id) => {
            event.preventDefault();
            void run(
              () => updateFacetValue(id, valueFieldsOf(event.currentTarget)),
              t.saved
            );
          }}
          onAddValue={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const code = textOf(new FormData(form), 'code');
            void run(
              () =>
                createFacetValue(group.id, { code, ...valueFieldsOf(form) }),
              t.valueAdded
            ).then((added) => added && form.reset());
          }}
        />
      ))}
      <form
        onSubmit={(event) => void create(event)}
        aria-label={t.newGroup}
        className="flex max-w-xl flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">{t.newGroup}</h2>
        <label className="flex flex-col gap-1">
          {t.code}
          <input
            name="code"
            required
            maxLength={50}
            pattern="[a-z0-9]+([\-_][a-z0-9]+)*"
            aria-describedby="facet-code-hint"
            className={FIELD}
          />
          <span id="facet-code-hint" className="text-sm">
            {t.codeHint}
          </span>
        </label>
        <GroupFields texts={t} />
        <button
          type="submit"
          disabled={busy}
          className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? t.creating : t.createGroup}
        </button>
      </form>
    </section>
  );
}

/** The names, order and flags of a group, empty for a new one or filled for an edit. */
function GroupFields({
  texts,
  group,
}: Readonly<{ texts: Texts; group?: FacetGroup }>) {
  return (
    <>
      <label className="flex flex-col gap-1">
        {texts.nameEs}
        <input
          name="nameEs"
          required
          maxLength={100}
          defaultValue={group?.nameEs}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        {texts.nameEn}
        <input
          name="nameEn"
          required
          maxLength={100}
          defaultValue={group?.nameEn}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        {texts.order}
        <input
          name="sortOrder"
          type="number"
          required
          min={-1000}
          max={1000}
          defaultValue={group?.sortOrder ?? 0}
          className={FIELD}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        {FLAGS.map(([field, key, initial]) => (
          <label key={field} className="flex items-center gap-2">
            <input
              name={field}
              type="checkbox"
              defaultChecked={group ? group[field] : initial}
            />
            {texts.flags[key]}
          </label>
        ))}
      </div>
    </>
  );
}

/** One group: its summary and actions, its values and the form to add one. */
function GroupCard({
  texts,
  group,
  busy,
  editingGroup,
  editingValue,
  onEditGroup,
  onEditValue,
  onSaveGroup,
  onToggle,
  onSaveValue,
  onAddValue,
}: Readonly<{
  texts: Texts;
  group: FacetGroup;
  busy: boolean;
  editingGroup: boolean;
  editingValue: number | null;
  onEditGroup: (id: number | null) => void;
  onEditValue: (id: number | null) => void;
  onSaveGroup: (event: SubmitEvent<HTMLFormElement>) => void;
  onToggle: () => void;
  onSaveValue: (event: SubmitEvent<HTMLFormElement>, id: number) => void;
  onAddValue: (event: SubmitEvent<HTMLFormElement>) => void;
}>) {
  const flags = FLAGS.filter(([field]) => group[field]).map(
    ([, key]) => texts.flags[key]
  );
  return (
    <article
      aria-label={group.nameEs}
      className="flex flex-col gap-3 rounded-lg border border-petroleo/20 p-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{group.nameEs}</h2>
        <span className="text-sm">
          {group.nameEn} · {group.code}
        </span>
        {group.isSystem && <span className="text-sm">{texts.system}</span>}
        {!group.isActive && <span className="text-sm">{texts.retired}</span>}
      </header>
      {editingGroup ? (
        <form
          onSubmit={onSaveGroup}
          aria-label={`${texts.edit}: ${group.nameEs}`}
          className="flex max-w-xl flex-col gap-3"
        >
          <GroupFields texts={texts} group={group} />
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="tap-target underline"
            >
              {busy ? texts.saving : texts.save}
            </button>
            <button
              type="button"
              onClick={() => onEditGroup(null)}
              className="tap-target underline"
            >
              {texts.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm">{flags.join(' · ')}</p>
          <button
            type="button"
            aria-label={`${texts.edit}: ${group.nameEs}`}
            onClick={() => onEditGroup(group.id)}
            className="tap-target underline"
          >
            {texts.edit}
          </button>
          {!group.isSystem && (
            <button
              type="button"
              disabled={busy}
              aria-label={`${group.isActive ? texts.retire : texts.reactivate}: ${group.nameEs}`}
              onClick={onToggle}
              className="tap-target underline"
            >
              {group.isActive ? texts.retire : texts.reactivate}
            </button>
          )}
        </div>
      )}
      <ValuesTable
        texts={texts}
        group={group}
        busy={busy}
        editingValue={editingValue}
        onEditValue={onEditValue}
        onSaveValue={onSaveValue}
      />
      {!group.isSystem && (
        <form
          onSubmit={onAddValue}
          aria-label={`${texts.newValue}: ${group.nameEs}`}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1">
            {texts.code}
            <input
              name="code"
              required
              maxLength={50}
              pattern="[a-z0-9]+([\-_][a-z0-9]+)*"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1">
            {texts.valueEs}
            <input name="valueEs" required maxLength={100} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            {texts.valueEn}
            <input name="valueEn" required maxLength={100} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            {texts.order}
            <input
              name="sortOrder"
              type="number"
              required
              min={-1000}
              max={1000}
              defaultValue={0}
              className={FIELD}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="tap-target underline"
          >
            {busy ? texts.adding : texts.addValue}
          </button>
        </form>
      )}
    </article>
  );
}

/** The values of a group; a system group's are read-only. */
function ValuesTable({
  texts,
  group,
  busy,
  editingValue,
  onEditValue,
  onSaveValue,
}: Readonly<{
  texts: Texts;
  group: FacetGroup;
  busy: boolean;
  editingValue: number | null;
  onEditValue: (id: number | null) => void;
  onSaveValue: (event: SubmitEvent<HTMLFormElement>, id: number) => void;
}>) {
  if (group.values.length === 0) return <p>{texts.noValues}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{`${texts.values}: ${group.nameEs}`}</caption>
        <thead>
          <tr>
            <th scope="col">{texts.code}</th>
            <th scope="col">{texts.valueEs}</th>
            <th scope="col">{texts.valueEn}</th>
            <th scope="col">{texts.order}</th>
            {!group.isSystem && <td />}
          </tr>
        </thead>
        <tbody>
          {group.values.map((value) =>
            editingValue === value.id ? (
              <tr key={value.id}>
                <td colSpan={5}>
                  <form
                    onSubmit={(event) => onSaveValue(event, value.id)}
                    aria-label={`${texts.edit}: ${value.valueEs}`}
                    className="flex flex-wrap items-end gap-3 py-2"
                  >
                    <label className="flex flex-col gap-1">
                      {texts.valueEs}
                      <input
                        name="valueEs"
                        required
                        maxLength={100}
                        defaultValue={value.valueEs}
                        className={FIELD}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      {texts.valueEn}
                      <input
                        name="valueEn"
                        required
                        maxLength={100}
                        defaultValue={value.valueEn}
                        className={FIELD}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      {texts.order}
                      <input
                        name="sortOrder"
                        type="number"
                        required
                        min={-1000}
                        max={1000}
                        defaultValue={value.sortOrder}
                        className={FIELD}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="tap-target underline"
                    >
                      {busy ? texts.saving : texts.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditValue(null)}
                      className="tap-target underline"
                    >
                      {texts.cancel}
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={value.id}>
                <td>{value.code}</td>
                <td>{value.valueEs}</td>
                <td>{value.valueEn}</td>
                <td>{value.sortOrder}</td>
                {!group.isSystem && (
                  <td>
                    <button
                      type="button"
                      aria-label={`${texts.edit}: ${value.valueEs}`}
                      onClick={() => onEditValue(value.id)}
                      className="tap-target underline"
                    >
                      {texts.edit}
                    </button>
                  </td>
                )}
              </tr>
            )
          )}
        </tbody>
      </table>
      {group.isSystem && <p className="text-sm">{texts.systemValues}</p>}
    </div>
  );
}
