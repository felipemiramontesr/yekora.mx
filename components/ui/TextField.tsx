import type { ComponentProps, InputHTMLAttributes } from 'react';
import { Field } from './Field';

/** The look of a text input, with the red border an invalid one takes. */
const INPUT =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3 aria-invalid:border-red-700';

/** Props of {@link TextField}: those of {@link Field}, with the input's own attributes. */
type TextFieldProps = Omit<ComponentProps<typeof Field>, 'children'> & {
  /** Name, type, autocomplete, length, value and the like; the id and its links are the field's. */
  input?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'aria-describedby' | 'aria-invalid'
  >;
};

/**
 * A guided text input (FC 050): a {@link Field} whose control is a plain `<input>`, so every form
 * that only needs a line of text gets its label, its description with the simplest example and
 * its error tied to the input without drawing the control itself.
 *
 * @param input - The attributes of the input besides the ones the field ties.
 * @param field - Everything {@link Field} takes: id, label, description, example, error.
 */
export function TextField({ input, ...field }: Readonly<TextFieldProps>) {
  return (
    <Field {...field}>
      {(control) => <input {...control} className={INPUT} {...input} />}
    </Field>
  );
}
