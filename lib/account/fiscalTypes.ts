/**
 * The fiscal data a buyer gives to be invoiced (FC 077 F1): what the SAT asks a CFDI 4.0 for, one
 * judge for the browser and the API (ADR 0008).
 *
 * The data is judged in a fixed order (T1.2): RFC, legal name, tax regime, postal code and CFDI
 * use, and the first one that fails names the refusal. The store does not stamp invoices; these
 * checks only keep obviously wrong data out of the queue of the external system.
 *
 * @module
 */
import { z } from 'zod';

/** The tax regimes of the SAT catalog `c_RegimenFiscal`, as CFDI 4.0 names them. */
export const TAX_SYSTEMS = [
  '601',
  '603',
  '605',
  '606',
  '607',
  '608',
  '610',
  '611',
  '612',
  '614',
  '615',
  '616',
  '620',
  '621',
  '622',
  '623',
  '624',
  '625',
  '626',
] as const;

/** The uses of the SAT catalog `c_UsoCFDI`. */
export const CFDI_USES = [
  'G01',
  'G02',
  'G03',
  'I01',
  'I02',
  'I03',
  'I04',
  'I05',
  'I06',
  'I07',
  'I08',
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D07',
  'D08',
  'D09',
  'D10',
  'S01',
  'CP01',
  'CN01',
] as const;

const TAX_SYSTEM_SET: ReadonlySet<string> = new Set(TAX_SYSTEMS);
const CFDI_USE_SET: ReadonlySet<string> = new Set(CFDI_USES);

/**
 * The endings that name a capital regime ("S.A. de C.V."): CFDI 4.0 wants the legal name without
 * it. A closed list, compared after {@link carriesCapitalRegime} drops the punctuation, so every
 * spelling of each one is caught and a word that merely ends in those letters (CASA) is not.
 */
const CAPITAL_REGIMES = [
  'SA',
  'SA DE CV',
  'SAB',
  'SAB DE CV',
  'SAPI',
  'SAPI DE CV',
  'SAPIB',
  'SAPIB DE CV',
  'SAS',
  'SAS DE CV',
  'S DE RL',
  'S DE RL DE CV',
  'SPR DE RL',
  'SPR DE RL DE CV',
  'S EN C',
  'S EN C POR A',
  'S EN NC',
  'SC',
  'SCP',
  'AC',
] as const;

const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const LEGAL_NAME = /^[A-ZÑ&0-9.,'/\s]{1,254}$/;
const POSTAL_CODE = /^\d{5}$/;
/** What the ciphertext of the name leaves of its VARBINARY(512) column, in UTF-8 bytes. */
const LEGAL_NAME_BYTES = 483;

/**
 * Whether a legal name ends in a capital regime. Dots are dropped and commas, hyphens and runs of
 * spaces become one space before comparing; the name itself is stored as written.
 *
 * @param name - The legal name, in capitals.
 * @returns True when what is left ends in a space followed by one of the closed list.
 */
function carriesCapitalRegime(name: string): boolean {
  const plain = name
    .replaceAll('.', '')
    .replaceAll(/[,\s-]+/g, ' ')
    .trim();
  return CAPITAL_REGIMES.some((regime) => plain.endsWith(` ${regime}`));
}

/** A field as it is judged: trimmed and in capitals, as the SAT writes it. */
export const capitalsSchema = z.string().max(300).trim().toUpperCase();

/**
 * The four fields a profile and an invoice request share. They fix the shape only; what each value
 * may be is decided by {@link fiscalDataVerdict}, so every refusal carries its own code.
 */
export const fiscalDataShape = {
  rfc: capitalsSchema,
  legalName: capitalsSchema,
  taxSystem: capitalsSchema,
  postalCode: capitalsSchema,
};

/** Body of `PUT /v1/account/fiscal-profile`. */
export const fiscalProfileRequestSchema = z.strictObject({
  ...fiscalDataShape,
  defaultCfdiUse: capitalsSchema,
});

/** Why fiscal data is refused (T1.2). */
type FiscalDataRefusal =
  | 'INVALID_RFC_REJECT'
  | 'INVALID_LEGAL_NAME_REJECT'
  | 'INVALID_TAX_SYSTEM_REJECT'
  | 'INVALID_POSTAL_CODE_REJECT'
  | 'INVALID_CFDI_USE_REJECT';

/** The five values T1.2 judges. */
interface FiscalData {
  rfc: string;
  legalName: string;
  taxSystem: string;
  postalCode: string;
  cfdiUse: string;
}

/** The title of each refusal of T1.2; the code says which value failed. */
export const FISCAL_DATA_TITLES: Readonly<Record<FiscalDataRefusal, string>> = {
  INVALID_RFC_REJECT: 'The RFC is not valid',
  INVALID_LEGAL_NAME_REJECT:
    'The legal name is not valid, or carries its capital regime',
  INVALID_TAX_SYSTEM_REJECT: 'The tax regime is not in the SAT catalog',
  INVALID_POSTAL_CODE_REJECT: 'The postal code is not valid',
  INVALID_CFDI_USE_REJECT: 'The CFDI use is not in the SAT catalog',
};

const isLegalName = (name: string): boolean =>
  LEGAL_NAME.test(name) &&
  new TextEncoder().encode(name).length <= LEGAL_NAME_BYTES &&
  !carriesCapitalRegime(name);

/**
 * The gate of the fiscal data (T1.2).
 *
 * @param data - The five values, already trimmed and in capitals.
 * @returns FISCAL_DATA_ACCEPTED, or the refusal of the first value that fails.
 */
export function fiscalDataVerdict(
  data: FiscalData
): 'FISCAL_DATA_ACCEPTED' | FiscalDataRefusal {
  if (!RFC.test(data.rfc)) return 'INVALID_RFC_REJECT';
  if (!isLegalName(data.legalName)) return 'INVALID_LEGAL_NAME_REJECT';
  if (!TAX_SYSTEM_SET.has(data.taxSystem)) return 'INVALID_TAX_SYSTEM_REJECT';
  if (!POSTAL_CODE.test(data.postalCode)) return 'INVALID_POSTAL_CODE_REJECT';
  if (!CFDI_USE_SET.has(data.cfdiUse)) return 'INVALID_CFDI_USE_REJECT';
  return 'FISCAL_DATA_ACCEPTED';
}

/** Answer of `GET /v1/account/fiscal-profile`: the holder's own data. */
export const fiscalProfileSchema = z.object({
  rfc: z.string(),
  legalName: z.string(),
  taxSystem: z.string(),
  postalCode: z.string(),
  defaultCfdiUse: z.string(),
});

/** The holder's own fiscal data. */
export type FiscalProfile = z.infer<typeof fiscalProfileSchema>;

/**
 * Answer of `PUT /v1/account/fiscal-profile`: no fiscal data, because the API keeps what it
 * answered to retry a request and none of it may be kept in the clear.
 */
export const fiscalProfileSavedSchema = z.object({ saved: z.literal(true) });
