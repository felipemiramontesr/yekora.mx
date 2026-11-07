'use client';

import { useState } from 'react';
import { publishCatalog } from '@/lib/api/catalogAdminClient';
import { fill } from '@/lib/catalog/format';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';

/**
 * «Publicar cambios» (FC 029 T2.5): explains that the store shows catalog changes only after a
 * publication, and asks the API to rebuild it. The answer says when it was requested; the
 * rebuild itself takes 15 to 20 minutes, through every gate of the pipeline.
 *
 * @param texts - `account.catalog` texts.
 */
export function PublishPanel({ texts }: Readonly<{ texts: CatalogTexts }>) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setNote(null);
    const result = await publishCatalog();
    setBusy(false);
    setNote(
      result.ok
        ? fill(texts.publish.requested, {
            time: new Date(result.data.requestedAt).toLocaleTimeString(
              undefined,
              { hour: '2-digit', minute: '2-digit' }
            ),
          })
        : catalogFailureText(texts, result.reason)
    );
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h2 className="text-xl font-semibold">{texts.publish.title}</h2>
      <p>{texts.publish.explain}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void publish()}
        className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
      >
        {busy ? texts.publish.publishing : texts.publish.button}
      </button>
      {note && <output className="block">{note}</output>}
    </section>
  );
}
