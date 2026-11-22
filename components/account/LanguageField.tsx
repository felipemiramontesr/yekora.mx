'use client';

import type { Messages } from '@/app/i18n';
import { Field } from '../ui/Field';

/** The language an account reads the store's mail in: one of the two official languages. */
export type PreferredLocale = 'es-MX' | 'en';

/**
 * The language selector of the sign-up form and of «Mi información» (FC 067 T2.3), like the
 * preferred language of a Drupal account: a guided field, so its label, its hint with the simplest
 * example and its description are tied to the control, with the two official languages as options.
 *
 * @param id - Id of the select; the label and the hint are named after it.
 * @param texts - `account.language` texts.
 * @param exampleLabel - The word that introduces the example in the page's language.
 * @param value - The language now chosen.
 * @param onChange - Called with the language the person picks.
 */
export function LanguageField({
  id,
  texts,
  exampleLabel,
  value,
  onChange,
}: Readonly<{
  id: string;
  texts: Messages['account']['language'];
  exampleLabel: string;
  value: PreferredLocale;
  onChange: (next: PreferredLocale) => void;
}>) {
  return (
    <Field
      id={id}
      label={texts.label}
      description={texts.description}
      example={texts.example}
      exampleLabel={exampleLabel}
    >
      {(control) => (
        <select
          {...control}
          name="preferredLocale"
          value={value}
          onChange={(event) =>
            onChange(event.target.value === 'en' ? 'en' : 'es-MX')
          }
          className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3"
        >
          <option value="es-MX">{texts.options['es-MX']}</option>
          <option value="en">{texts.options.en}</option>
        </select>
      )}
    </Field>
  );
}
