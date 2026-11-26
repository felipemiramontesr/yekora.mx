/**
 * The two pure gates of the payments mode switch (FC 075, K-75 second part): whether a
 * confirmation is permitted (T1.1) and whether the second factor of one delicate action was proved
 * (T1.3). Each answers with the first condition that fails, in the order of its table.
 *
 * @module
 */

/** The rows of T1.1 as the machine names them. */
export type SwitchCode =
  | 'SWITCH_PERMITTED'
  | 'SWITCH_CHALLENGE_INVALID'
  | 'SWITCH_PHRASE_MISMATCH'
  | 'SWITCH_TOTP_FAILED'
  | 'SWITCH_OWNER_REQUIRED';

/** The four inputs of T1.1: S, P, T, O. */
interface SwitchInputs {
  /** S: the ticket exists, is pending and has not expired. */
  challenge: boolean;
  /** P: the phrase is exactly the canonical one. */
  phrase: boolean;
  /** T: the code of the authenticator is right. */
  totp: boolean;
  /** O: who confirms is the owner. */
  owner: boolean;
}

/**
 * T1.1 · PaymentModeSwitchGate(S, P, T, O).
 *
 * @param inputs - The four conditions.
 * @returns The row of the table that applies.
 */
export function decideModeSwitch(inputs: SwitchInputs): SwitchCode {
  if (!inputs.challenge) return 'SWITCH_CHALLENGE_INVALID';
  if (!inputs.phrase) return 'SWITCH_PHRASE_MISMATCH';
  if (!inputs.totp) return 'SWITCH_TOTP_FAILED';
  return inputs.owner ? 'SWITCH_PERMITTED' : 'SWITCH_OWNER_REQUIRED';
}

/** The rows of T1.3 as the machine names them. */
export type StepUpCode =
  | 'STEP_UP_GRANTED_200'
  | 'STEP_UP_UNAUTHORIZED_401'
  | 'STEP_UP_NOT_ENROLLED_403'
  | 'STEP_UP_CODE_INVALID_403';

/** The three inputs of T1.3: A, E, C. */
interface StepUpInputs {
  /** A: the privileged session is active. */
  active: boolean;
  /** E: the account has its authenticator turned on. */
  enrolled: boolean;
  /** C: the code is the one of this moment. */
  valid: boolean;
}

/**
 * T1.3 · StepUpTotpGate(A, E, C).
 *
 * @param inputs - The three conditions.
 * @returns The row of the table that applies.
 */
export function decideStepUp(inputs: StepUpInputs): StepUpCode {
  if (!inputs.active) return 'STEP_UP_UNAUTHORIZED_401';
  if (!inputs.enrolled) return 'STEP_UP_NOT_ENROLLED_403';
  return inputs.valid ? 'STEP_UP_GRANTED_200' : 'STEP_UP_CODE_INVALID_403';
}
