'use client';

import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import type { Messages } from '@/app/i18n';
import {
  PASSWORD_MAX,
  type PasswordContext,
  type PasswordRule,
  passwordChecks,
} from '@/lib/account/passwordPolicy';

/** The `account.password` texts. */
type PasswordTexts = Messages['account']['password'];

/** Props of {@link PasswordField}. */
interface PasswordFieldProps {
  /** Input id; the eye button controls it. */
  id: string;
  /** Visible label. */
  label: string;
  /** Current value. */
  value: string;
  /** Called with the new value. */
  onChange: (value: string) => void;
  /** `current-password` to sign in, `new-password` to choose one. */
  autoComplete: 'current-password' | 'new-password';
  /** Name of the eye button while the password is hidden, and while it is shown. */
  toggle: { show: string; hide: string };
  /** Id of the live list of rules that describes this field, if any. */
  describedBy?: string;
}

/**
 * A password input with its eye button (FC 042 T1.3, T2.5): every password field of the site has
 * its own. The button is a real `type="button"`, so it never submits the form; it swaps the input
 * between `password` and `text`, and its `aria-pressed` and `aria-label` follow the state.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  toggle,
  describedBy,
}: Readonly<PasswordFieldProps>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={PASSWORD_MAX}
          aria-describedby={describedBy}
          className="min-h-11 w-full rounded-md border border-petroleo/30 bg-white pl-3 pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-pressed={visible}
          aria-label={visible ? toggle.hide : toggle.show}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-petroleo"
        >
          {visible ? (
            <EyeOff aria-hidden="true" size={20} />
          ) : (
            <Eye aria-hidden="true" size={20} />
          )}
        </button>
      </div>
    </div>
  );
}

/** One line of the live list: its icon and a word for screen readers, never the colour alone. */
function RuleLine({
  met,
  text,
  texts,
}: Readonly<{ met: boolean; text: string; texts: PasswordTexts }>) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {met ? (
        <Check
          aria-hidden="true"
          size={18}
          className="mt-0.5 shrink-0 text-green-800"
        />
      ) : (
        <X
          aria-hidden="true"
          size={18}
          className="mt-0.5 shrink-0 text-petroleo/60"
        />
      )}
      <span className={met ? 'text-green-900' : 'text-petroleo/80'}>
        <span className="sr-only">{met ? texts.met : texts.missing} </span>
        {text}
      </span>
    </li>
  );
}

/** Props of {@link NewPasswordFields}. */
interface NewPasswordFieldsProps {
  /** Id prefix of both inputs and of the list. */
  id: string;
  /** Labels of the password and of its repetition. */
  labels: { password: string; confirm: string };
  /** The password and its repetition, as typed. */
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  /** The e-mail and name it must not contain (empty where the form does not know them). */
  context: PasswordContext;
  /** The rules this form can check, in order (the reset form cannot know the e-mail or name). */
  rules: readonly PasswordRule[];
  /** `account.password` texts. */
  texts: PasswordTexts;
}

/**
 * Whether a new password may be sent (FC 042 T1.4): every rule the form shows is met and both
 * fields match.
 *
 * @param password - The password.
 * @param confirm - Its repetition, which never leaves the browser (T2.7).
 * @param context - The e-mail and name it must not contain.
 * @param rules - The rules the form shows.
 * @returns True when the submit button may turn on.
 */
export function newPasswordReady(
  password: string,
  confirm: string,
  context: PasswordContext,
  rules: readonly PasswordRule[]
): boolean {
  const checks = passwordChecks(password, context);
  return rules.every((rule) => checks[rule]) && confirm === password;
}

/**
 * A new password, its repetition and the live list under them (FC 042 T1.4, T2.7): each rule of
 * the policy and the match of both fields, met or missing as the person types. The list is a
 * polite live region, so a screen reader hears it change, and each line says «met» or «missing»
 * in words as well as with its icon.
 */
export function NewPasswordFields({
  id,
  labels,
  password,
  confirm,
  onPassword,
  onConfirm,
  context,
  rules,
  texts,
}: Readonly<NewPasswordFieldsProps>) {
  const checks = passwordChecks(password, context);
  const list = `${id}-rules`;
  return (
    <>
      <PasswordField
        id={`${id}-password`}
        label={labels.password}
        value={password}
        onChange={onPassword}
        autoComplete="new-password"
        toggle={{ show: texts.show, hide: texts.hide }}
        describedBy={list}
      />
      <PasswordField
        id={`${id}-confirm`}
        label={labels.confirm}
        value={confirm}
        onChange={onConfirm}
        autoComplete="new-password"
        toggle={{ show: texts.showRepeat, hide: texts.hideRepeat }}
        describedBy={list}
      />
      <div id={list} aria-live="polite" className="flex flex-col gap-1">
        <p className="text-sm font-medium">{texts.rulesTitle}</p>
        <ul className="flex flex-col gap-1">
          {rules.map((rule) => (
            <RuleLine
              key={rule}
              met={checks[rule]}
              text={texts.rules[rule]}
              texts={texts}
            />
          ))}
          <RuleLine
            met={confirm !== '' && confirm === password}
            text={texts.match}
            texts={texts}
          />
        </ul>
      </div>
    </>
  );
}
