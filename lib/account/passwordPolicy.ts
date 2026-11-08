/**
 * The password policy of Yēkora (FC 042 Enmienda 1, T1.2, T2.6): one set of rules for every new
 * password (sign-up, reset and any later change), shared by the API, which enforces it, and the
 * account forms, which show each rule as it is met (T1.4). Accounts that already exist keep their
 * password: the policy applies only when a password is set.
 *
 * A password passes when it has 12 to 128 characters, an upper-case letter, a lower-case letter,
 * a digit and a symbol, does not contain the person's e-mail or name, and is not a common
 * password. Composition rules alone would accept `Password123!`, so the last rule looks for a
 * common word (and its l33t spellings) that makes up nearly all of the letters.
 *
 * It depends on nothing, so the site bundle can import it.
 *
 * @module
 */

/** Shortest accepted password. */
const PASSWORD_MIN = 12;
/** Longest accepted password. */
const PASSWORD_MAX = 128;

/** Every rule, in the order the form lists them and the API reports the first one broken. */
const PASSWORD_RULES = [
  'length',
  'uppercase',
  'lowercase',
  'digit',
  'symbol',
  'personal',
  'common',
] as const;

/** One rule of the policy. */
type PasswordRule = (typeof PASSWORD_RULES)[number];

/** Whether each rule is met. */
type PasswordChecks = Readonly<Record<PasswordRule, boolean>>;

/** What the password must not contain: the person's own e-mail and name. */
export interface PasswordContext {
  /** E-mail as typed; empty when not known yet. */
  email: string;
  /** Full name as typed; empty when not known yet. */
  fullName: string;
}

/**
 * Words that make a password guessable however it is dressed with digits and symbols: the most
 * common passwords of public breach lists, keyboard runs, and words of this site and language.
 */
const COMMON_WORDS = [
  'password',
  'contrasena',
  'clave',
  'qwerty',
  'qwertz',
  'azerty',
  'asdfgh',
  'zxcvbn',
  'abcdef',
  'admin',
  'administrador',
  'welcome',
  'bienvenido',
  'letmein',
  'iloveyou',
  'teamo',
  'monkey',
  'dragon',
  'football',
  'futbol',
  'baseball',
  'master',
  'sunshine',
  'princess',
  'shadow',
  'superman',
  'batman',
  'trustno',
  'secret',
  'secreto',
  'login',
  'usuario',
  'changeme',
  'default',
  'yekora',
  'mexico',
];

/** Letters a common word may hide behind (l33t), each replaced one for one. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** How many letters may surround a common word before the password stops being "that word". */
const COMMON_SLACK = 3;
/** A password needs at least this many different characters. */
const MIN_DISTINCT = 5;

/** Lower case without accents, so «Peña» and «pena» compare equal; one character per character. */
function fold(text: string): string {
  return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase();
}

/** Whether the password holds the e-mail (or the part before @) or a word of the name. */
function containsPersonal(password: string, context: PasswordContext): boolean {
  const folded = fold(password);
  const email = fold(context.email.trim());
  const local = email.split('@')[0];
  const parts = [email, local, ...fold(context.fullName).split(/\s+/)];
  return parts.some((part) => part.length >= 3 && folded.includes(part));
}

/** Whether a common word, or a l33t spelling of it, makes up nearly all the password's letters. */
function isCommon(password: string): boolean {
  const folded = fold(password);
  if (new Set(folded).size < MIN_DISTINCT) return true;
  const plain = [...folded].map((char) => LEET[char] ?? char).join('');
  return COMMON_WORDS.some((word) => {
    const at = plain.indexOf(word);
    if (at === -1) return false;
    const rest = folded.slice(0, at) + folded.slice(at + word.length);
    return (rest.match(/\p{L}/gu) ?? []).length <= COMMON_SLACK;
  });
}

/**
 * Checks every rule, for the live list of the forms.
 *
 * @param password - The password as typed.
 * @param context - The e-mail and name it must not contain.
 * @returns Whether each rule is met.
 */
function passwordChecks(
  password: string,
  context: PasswordContext
): PasswordChecks {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    uppercase: /\p{Lu}/u.test(password),
    lowercase: /\p{Ll}/u.test(password),
    digit: /\p{Nd}/u.test(password),
    symbol: /[^\p{L}\p{N}]/u.test(password),
    personal: !containsPersonal(password, context),
    common: !isCommon(password),
  };
}

/**
 * The first rule a password breaks, in {@link PASSWORD_RULES} order.
 *
 * @param password - The password as typed.
 * @param context - The e-mail and name it must not contain.
 * @returns The rule, or null when the password is accepted.
 */
export function passwordViolation(
  password: string,
  context: PasswordContext
): PasswordRule | null {
  const checks = passwordChecks(password, context);
  return PASSWORD_RULES.find((rule) => !checks[rule]) ?? null;
}

/**
 * The machine code of each broken rule, as the API answers it (400 problem `detail`) and the
 * forms translate it.
 */
export const PASSWORD_PROBLEMS = {
  length: 'PASSWORD_LENGTH',
  uppercase: 'PASSWORD_UPPERCASE',
  lowercase: 'PASSWORD_LOWERCASE',
  digit: 'PASSWORD_DIGIT',
  symbol: 'PASSWORD_SYMBOL',
  personal: 'PASSWORD_PERSONAL',
  common: 'PASSWORD_COMMON',
} as const satisfies Record<PasswordRule, string>;
