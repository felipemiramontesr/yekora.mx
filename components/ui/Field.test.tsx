// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field } from './Field';

afterEach(cleanup);

const field = (error?: string) => (
  <Field
    id="product-sku"
    label="SKU"
    description="Código único del producto."
    example="TENIS-01"
    exampleLabel="Ejemplo"
    error={error}
  >
    {(control) => <input {...control} name="sku" />}
  </Field>
);

describe('Field (FC 046 T1.3, T2.4)', () => {
  it('names the control with its label and puts the description and the simplest example below it', () => {
    render(field());
    const input = screen.getByLabelText('SKU');
    expect(input.id).toBe('product-sku');
    const hint = document.getElementById('product-sku-hint') as HTMLElement;
    expect(hint.textContent).toBe(
      'Código único del producto. Ejemplo: TENIS-01'
    );
    expect(input.getAttribute('aria-describedby')).toBe('product-sku-hint');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    // Below the control, not above it.
    expect(
      input.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds the error to the description of the control and marks it invalid', () => {
    render(field('Usa solo mayúsculas, números y guiones.'));
    const input = screen.getByLabelText('SKU');
    expect(input.getAttribute('aria-describedby')).toBe(
      'product-sku-hint product-sku-error'
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('product-sku-error');
    expect(alert.textContent).toBe('Usa solo mayúsculas, números y guiones.');
    // The hint stays: the error does not replace how to fill the field in.
    expect(document.getElementById('product-sku-hint')).toBeTruthy();
  });

  it('writes the word that introduces the example in the language it is given', () => {
    render(
      <Field
        id="x"
        label="Name"
        description="The product name."
        example="Trail shoes"
        exampleLabel="Example"
      >
        {(control) => <input {...control} />}
      </Field>
    );
    expect(document.getElementById('x-hint')?.textContent).toBe(
      'The product name. Example: Trail shoes'
    );
  });
});
