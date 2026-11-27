/**
 * FC 077 F1 evidence: the gate of the fiscal data with the 32 rows of T1.2, the RFC of a person
 * and of a company, the SAT catalogs, and the closed list of capital regimes.
 */
import { describe, expect, it } from 'vitest';
import { fiscalDataVerdict, fiscalProfileRequestSchema } from './fiscalTypes';

const TAX_SYSTEMS =
  '601 603 605 606 607 608 610 611 612 614 615 616 620 621 622 623 624 625 626';
const CFDI_USES =
  'G01 G02 G03 I01 I02 I03 I04 I05 I06 I07 I08 D01 D02 D03 D04 D05 D06 D07 D08 D09 D10 S01 CP01 CN01';

const GOOD = {
  rfc: 'XAXX010101000',
  legalName: 'ANA KAREN FLORES BACA',
  taxSystem: '612',
  postalCode: '98612',
  cfdiUse: 'G03',
};
const BAD = {
  rfc: 'NOPE',
  legalName: 'ACME S.A. DE C.V.',
  taxSystem: '999',
  postalCode: '9861',
  cfdiUse: 'Z99',
};
const ORDER = [
  ['rfc', 'INVALID_RFC_REJECT'],
  ['legalName', 'INVALID_LEGAL_NAME_REJECT'],
  ['taxSystem', 'INVALID_TAX_SYSTEM_REJECT'],
  ['postalCode', 'INVALID_POSTAL_CODE_REJECT'],
  ['cfdiUse', 'INVALID_CFDI_USE_REJECT'],
] as const;

describe('the gate of the fiscal data (T1.2)', () => {
  const rows = Array.from({ length: 32 }, (_, row) =>
    ORDER.map((_field, bit) => (row & (16 >> bit)) === 0)
  );

  it.each(rows)(
    'R=%s N=%s S=%s C=%s U=%s: the first value that fails names the refusal',
    (...holds) => {
      const data = Object.fromEntries(
        ORDER.map(([field], index) => [
          field,
          holds[index] ? GOOD[field] : BAD[field],
        ])
      ) as typeof GOOD;
      const first = holds.indexOf(false);
      expect(fiscalDataVerdict(data)).toBe(
        first === -1 ? 'FISCAL_DATA_ACCEPTED' : ORDER[first][1]
      );
    }
  );

  it('takes the RFC of a person (13) and of a company (12), with Ñ and &, and nothing else', () => {
    for (const rfc of ['XAXX010101000', 'ABC010101AB1', 'Ñ&A010101AB1']) {
      expect(fiscalDataVerdict({ ...GOOD, rfc })).toBe('FISCAL_DATA_ACCEPTED');
    }
    for (const rfc of ['AB010101AB1', 'ABCDE010101AB1', 'ABC01010AAB1']) {
      expect(fiscalDataVerdict({ ...GOOD, rfc })).toBe('INVALID_RFC_REJECT');
    }
  });

  it('takes every regime and every use of the SAT catalogs', () => {
    for (const taxSystem of TAX_SYSTEMS.split(' ')) {
      expect(fiscalDataVerdict({ ...GOOD, taxSystem })).toBe(
        'FISCAL_DATA_ACCEPTED'
      );
    }
    for (const cfdiUse of CFDI_USES.split(' ')) {
      expect(fiscalDataVerdict({ ...GOOD, cfdiUse })).toBe(
        'FISCAL_DATA_ACCEPTED'
      );
    }
  });

  it.each([
    ['empty', ''],
    ['with a character outside the set', 'ANA "LA" TIENDA'],
    ['longer than 254', 'A'.repeat(255)],
    ['whose ciphertext would not fit its column', 'Ñ'.repeat(242)],
  ])('refuses a legal name %s', (_case, legalName) => {
    expect(fiscalDataVerdict({ ...GOOD, legalName })).toBe(
      'INVALID_LEGAL_NAME_REJECT'
    );
  });

  it('reads the fields trimmed and in capitals, and refuses any other field', () => {
    const body = {
      rfc: ' xaxx010101000 ',
      legalName: ' la rosa ',
      taxSystem: '612',
      postalCode: '98612',
      defaultCfdiUse: 'g03',
    };
    expect(fiscalProfileRequestSchema.parse(body)).toMatchObject({
      rfc: 'XAXX010101000',
      legalName: 'LA ROSA',
      defaultCfdiUse: 'G03',
    });
    expect(
      fiscalProfileRequestSchema.safeParse({ ...body, userId: 'x' }).success
    ).toBe(false);
  });
});

describe('the capital regime of a legal name', () => {
  it.each([
    'ACME S.A. DE C.V.',
    'ACME SA DE CV',
    'ACME, S. DE R.L.',
    'ACME S DE RL',
    'ACME S. DE R.L. DE C.V.',
    'ACME S. EN C.',
    'ACME S.A.P.I. DE C.V.',
    'ACME S.C.',
    'ACME A.C.',
  ])('refuses %s, which carries it', (legalName) => {
    expect(fiscalDataVerdict({ ...GOOD, legalName })).toBe(
      'INVALID_LEGAL_NAME_REJECT'
    );
  });

  it.each(['CASA', 'LA ROSA', 'ISA', 'GRUPO CASA', 'SA', 'SA DE CV NORTE'])(
    'accepts %s',
    (legalName) => {
      expect(fiscalDataVerdict({ ...GOOD, legalName })).toBe(
        'FISCAL_DATA_ACCEPTED'
      );
    }
  );
});
