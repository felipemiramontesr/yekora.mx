import type { ReactNode } from 'react';

/** What a control must carry to be tied to its {@link Field}: its id and its descriptions. */
interface ControlProps {
  id: string;
  'aria-describedby': string;
  'aria-invalid'?: true;
}

/** Props of {@link Field}. */
interface FieldProps {
  /** Id of the control; the label, the hint and the error are named after it. */
  id: string;
  /** What the field is called. */
  label: string;
  /** How to fill it in, in a short sentence. */
  description: string;
  /** The simplest example the field accepts. */
  example: string;
  /** The word that introduces the example in the page's language («Ejemplo», «Example»). */
  exampleLabel: string;
  /** Why the value was refused; absent while the field is fine. */
  error?: string;
  /** Draws the control from the props that tie it to the field. */
  children: (control: ControlProps) => ReactNode;
}

/**
 * A guided form field (FC 046 T1.3, T2.4): the label above, the control, and below it how to fill
 * it in with the simplest example it accepts, so nobody has to guess. The label points at the
 * control (`htmlFor`), the control points at its hint (`aria-describedby`) and, when there is an
 * error, at the error too and is marked invalid. The control is drawn by `children` from the
 * props this component hands it, so the three links can never be forgotten.
 *
 * @param id - Id of the control.
 * @param label - The field's name.
 * @param description - How to fill it in.
 * @param example - The simplest example.
 * @param exampleLabel - The word that introduces the example.
 * @param error - The refusal, when there is one.
 * @param children - Draws the control from the props that tie it to the field.
 */
export function Field({
  id,
  label,
  description,
  example,
  exampleLabel,
  error,
  children,
}: Readonly<FieldProps>) {
  const hint = `${id}-hint`;
  const failure = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': error ? `${hint} ${failure}` : hint,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      <p id={hint} className="text-sm">
        {description}{' '}
        <span className="font-medium">{`${exampleLabel}: ${example}`}</span>
      </p>
      {error && (
        <p id={failure} role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
