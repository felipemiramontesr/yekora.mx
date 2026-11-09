'use client';

import qrcode from 'qrcode-generator';
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useId,
  useState,
} from 'react';
import type { Messages } from '@/app/i18n';
import {
  PASSWORD_RULES,
  type PasswordContext,
  type PasswordRule,
} from '@/lib/account/passwordPolicy';
import {
  type AccountFailure,
  checkReset,
  confirm,
  enroll,
  forgotPassword,
  login,
  register,
  resetPassword,
  verify,
} from '@/lib/api/accountClient';
import { fill } from '@/lib/catalog/format';
import { Field } from '../checkout/CheckoutFields';
import {
  NewPasswordFields,
  newPasswordReady,
  PasswordField,
} from './PasswordFields';

/** The `account` texts. */
type AccountMessages = Messages['account'];

/** Where a challenge's code comes from. */
export type Channel = 'email' | 'authenticator';

/** A code as the API accepts it: 6 digits, or 8 for a backup code. */
const CODE = /^(?:\d{6}|\d{8})$/;

const BUTTON =
  'min-h-11 rounded-md bg-petroleo px-6 font-semibold text-marfil disabled:cursor-not-allowed disabled:opacity-60';
const LINK_BUTTON = 'tap-target text-sm underline underline-offset-4';

/** A refusal or a client-side check, announced to assistive technology. */
export function FormAlert({ text }: Readonly<{ text: string | null }>) {
  return text ? (
    <p role="alert" className="font-medium text-red-800">
      {text}
    </p>
  ) : null;
}

/** The text of a failure. */
export function failureText(
  messages: AccountMessages,
  reason: AccountFailure
): string {
  return messages.errors[reason];
}

/**
 * Sign-in with e-mail and password (step one): opens the challenge whose code comes next, or
 * signs a buyer straight in on a device remembered for 30 days (Enmienda 1, E2).
 *
 * @param messages - `account` texts.
 * @param initialEmail - The e-mail just registered, if any.
 * @param notice - A message to show above the form (e.g. after registering).
 * @param onChallenge - Called with the open challenge.
 * @param onSignedIn - The session is open without a code (trusted device).
 * @param onRegister - Switches to the sign-up form.
 * @param onForgot - Switches to «¿Olvidaste tu contraseña?» (FC 042), with the e-mail typed.
 */
export function SignInForm({
  messages,
  initialEmail,
  notice,
  onChallenge,
  onSignedIn,
  onRegister,
  onForgot,
}: Readonly<{
  messages: AccountMessages;
  initialEmail: string;
  notice: string | null;
  onChallenge: (challenge: {
    challengeId: string;
    channel: Channel;
    email: string;
  }) => void;
  onSignedIn: () => void;
  onRegister: () => void;
  onForgot: (email: string) => void;
}>) {
  const base = useId();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The form is prerendered so it shows at once (322_AN), but React only owns it once it has
  // hydrated: until then its fields stay disabled, so nothing typed is lost and nothing is sent
  // natively (FC 035 T1.1, the same guard as the catalog filters).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(messages.errors.required);
      return;
    }
    setBusy(true);
    const result = await login({ email, password });
    setBusy(false);
    if (!result.ok) {
      setError(failureText(messages, result.reason));
      return;
    }
    const answer = result.data;
    if ('status' in answer) onSignedIn();
    else
      onChallenge({
        challengeId: answer.challengeId,
        channel: answer.channel,
        email: email.trim(),
      });
  }

  return (
    // method="post": even a native submission could never put the password in the URL.
    <form
      noValidate
      method="post"
      onSubmit={submit}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold">{messages.signIn.title}</h2>
      {notice && <output className="block text-sm">{notice}</output>}
      <p className="text-petroleo/80">{messages.signIn.intro}</p>
      <FormAlert text={error} />
      <fieldset disabled={!hydrated} className="contents">
        <Field
          id={`${base}-email`}
          label={messages.signIn.email}
          value={email}
          onChange={setEmail}
          input={{ type: 'email', autoComplete: 'username', maxLength: 255 }}
        />
        <PasswordField
          id={`${base}-password`}
          label={messages.signIn.password}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          toggle={messages.password}
        />
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? messages.signIn.submitting : messages.signIn.submit}
        </button>
        <button
          type="button"
          onClick={() => onForgot(email.trim())}
          className={LINK_BUTTON}
        >
          {messages.signIn.forgot}
        </button>
        <button type="button" onClick={onRegister} className={LINK_BUTTON}>
          {messages.signIn.toRegister}
        </button>
      </fieldset>
    </form>
  );
}

/**
 * Every rule of the policy. Sign-up knows the e-mail and name as they are typed; reset learns them
 * from `reset-password/check` (Enmienda 2), so both forms check all seven.
 */
const ALL_RULES: readonly PasswordRule[] = PASSWORD_RULES;

/**
 * Sign-up of a buyer account (FC 042 Enmienda 1). The password is typed twice, each field with its
 * eye, and the live list under them shows every rule met or missing; «Crear cuenta» turns on
 * only when all are met and both match (T1.4). The repetition never leaves the browser (T2.7).
 * The API answers the same whether the e-mail existed or not, so the form says the same too, and
 * goes back to sign-in with the e-mail filled in.
 *
 * @param messages - `account` texts.
 * @param onRegistered - Called with the e-mail after the API accepted.
 * @param onSignIn - Switches back to the sign-in form.
 */
export function RegisterForm({
  messages,
  onRegistered,
  onSignIn,
}: Readonly<{
  messages: AccountMessages;
  onRegistered: (email: string) => void;
  onSignIn: () => void;
}>) {
  const base = useId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = { email, fullName };
  const ready = newPasswordReady(password, repeated, context, ALL_RULES);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setError(messages.errors.required);
      return;
    }
    setBusy(true);
    const result = await register({ email, password, fullName });
    setBusy(false);
    if (result.ok) {
      onRegistered(email.trim());
      return;
    }
    setError(failureText(messages, result.reason));
  }

  return (
    <form
      noValidate
      method="post"
      onSubmit={submit}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold">{messages.register.title}</h2>
      <p className="text-petroleo/80">{messages.register.intro}</p>
      <FormAlert text={error} />
      <Field
        id={`${base}-name`}
        label={messages.register.fullName}
        value={fullName}
        onChange={setFullName}
        input={{ autoComplete: 'name', maxLength: 150 }}
      />
      <Field
        id={`${base}-email`}
        label={messages.register.email}
        value={email}
        onChange={setEmail}
        input={{ type: 'email', autoComplete: 'email', maxLength: 255 }}
      />
      <NewPasswordFields
        id={base}
        labels={{
          password: messages.register.password,
          confirm: messages.register.confirm,
        }}
        password={password}
        confirm={repeated}
        onPassword={setPassword}
        onConfirm={setRepeated}
        context={context}
        rules={ALL_RULES}
        texts={messages.password}
      />
      <button type="submit" disabled={busy || !ready} className={BUTTON}>
        {busy ? messages.register.submitting : messages.register.submit}
      </button>
      <button type="button" onClick={onSignIn} className={LINK_BUTTON}>
        {messages.register.toSignIn}
      </button>
    </form>
  );
}

/**
 * «¿Olvidaste tu contraseña?» (FC 042 T1.1): the e-mail of the account, for a 15-minute link.
 * The API answers the same whether the e-mail has an account or not, and so does this form.
 *
 * @param messages - `account` texts.
 * @param initialEmail - The e-mail already typed in the sign-in form.
 * @param onSignIn - Back to the sign-in form.
 */
export function ForgotForm({
  messages,
  initialEmail,
  onSignIn,
}: Readonly<{
  messages: AccountMessages;
  initialEmail: string;
  onSignIn: () => void;
}>) {
  const base = useId();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError(messages.errors.required);
      return;
    }
    setBusy(true);
    const result = await forgotPassword(email);
    setBusy(false);
    setError(result.ok ? null : failureText(messages, result.reason));
    setSent(result.ok);
  }

  return (
    <form
      noValidate
      method="post"
      onSubmit={submit}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold">{messages.forgot.title}</h2>
      <p className="text-petroleo/80">{messages.forgot.intro}</p>
      <FormAlert text={error} />
      {sent && <output className="block">{messages.forgot.sent}</output>}
      <Field
        id={`${base}-email`}
        label={messages.forgot.email}
        value={email}
        onChange={setEmail}
        input={{ type: 'email', autoComplete: 'username', maxLength: 255 }}
      />
      <button type="submit" disabled={busy} className={BUTTON}>
        {busy ? messages.forgot.submitting : messages.forgot.submit}
      </button>
      <button type="button" onClick={onSignIn} className={LINK_BUTTON}>
        {messages.forgot.back}
      </button>
    </form>
  );
}

/**
 * The page of the mailed link (FC 042 T1.2). It first asks `reset-password/check` whose account
 * the link resets (Enmienda 2, T1.5) and names it; then the new password twice, with the eyes and
 * the live list of all 8 lines, `personal` checked against that account (T2.7). The API checks the
 * link again, spends it and ends every session; a spent or expired link offers to ask for another.
 *
 * @param messages - `account` texts.
 * @param token - The token of the link, already taken out of the address bar.
 * @param onDone - The password changed: back to sign-in with a notice.
 * @param onForgot - Ask for another link.
 */
export function ResetForm({
  messages,
  token,
  onDone,
  onForgot,
}: Readonly<{
  messages: AccountMessages;
  token: string;
  onDone: () => void;
  onForgot: () => void;
}>) {
  const base = useId();
  const [password, setPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountFailure | null>(null);
  const [account, setAccount] = useState<PasswordContext | null>(null);
  const ready =
    account !== null &&
    newPasswordReady(password, repeated, account, ALL_RULES);

  useEffect(() => {
    let live = true;
    void checkReset(token).then((result) => {
      if (!live) return;
      if (result.ok) setAccount(result.data);
      else setError(result.reason);
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const result = await resetPassword({ token, password });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.reason);
  }

  return (
    <form
      noValidate
      method="post"
      onSubmit={submit}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold">{messages.reset.title}</h2>
      <p className="text-petroleo/80">{messages.reset.intro}</p>
      <FormAlert text={error && failureText(messages, error)} />
      {account === null && error === null && (
        <output className="block">{messages.reset.checking}</output>
      )}
      {account && (
        <>
          <p className="font-medium break-all">
            {fill(messages.reset.account, { email: account.email })}
          </p>
          <NewPasswordFields
            id={base}
            labels={{
              password: messages.reset.password,
              confirm: messages.reset.confirm,
            }}
            password={password}
            confirm={repeated}
            onPassword={setPassword}
            onConfirm={setRepeated}
            context={account}
            rules={ALL_RULES}
            texts={messages.password}
          />
          <button type="submit" disabled={busy || !ready} className={BUTTON}>
            {busy ? messages.reset.submitting : messages.reset.submit}
          </button>
        </>
      )}
      {error === 'RESET_TOKEN_INVALID' && (
        <button type="button" onClick={onForgot} className={LINK_BUTTON}>
          {messages.reset.again}
        </button>
      )}
    </form>
  );
}

/** One code input with its submit button, shared by the second-factor steps. */
function CodeInput({
  id,
  label,
  value,
  onChange,
  busy,
  submit,
  submitting,
  before,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  submit: string;
  submitting: string;
  /** Shown between the input and the button. */
  before?: ReactNode;
}>) {
  return (
    <>
      <Field
        id={id}
        label={label}
        value={value}
        onChange={(typed) => onChange(typed.replaceAll(/\D/g, ''))}
        input={{
          inputMode: 'numeric',
          autoComplete: 'one-time-code',
          maxLength: 8,
        }}
      />
      {before}
      <button type="submit" disabled={busy} className={BUTTON}>
        {busy ? submitting : submit}
      </button>
    </>
  );
}

/**
 * Step two: the code of the challenge, from the mailbox or the authenticator (or a backup code).
 *
 * @param messages - `account` texts.
 * @param challenge - The open challenge and where its code comes from.
 * @param onSignedIn - The session is open.
 * @param onEnroll - Staff passed the mailed code and must now enrol the authenticator.
 * @param onRestart - Back to the sign-in form.
 */
export function CodeForm({
  messages,
  challenge,
  onSignedIn,
  onEnroll,
  onRestart,
}: Readonly<{
  messages: AccountMessages;
  challenge: { challengeId: string; channel: Channel; email: string };
  onSignedIn: () => void;
  onEnroll: () => void;
  onRestart: () => void;
}>) {
  const base = useId();
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byMail = challenge.channel === 'email';

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!CODE.test(code)) {
      setError(messages.errors.codeFormat);
      return;
    }
    setBusy(true);
    const result = await verify({
      challengeId: challenge.challengeId,
      code,
      // Only the mailed code offers it: staff sign in with the authenticator and are never remembered.
      ...(byMail && remember ? { rememberDevice: true } : {}),
    });
    setBusy(false);
    if (result.ok) onSignedIn();
    else if (result.reason === 'TOTP_NOT_ENROLLED') onEnroll();
    else setError(failureText(messages, result.reason));
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <h2 className="text-2xl font-semibold">
        {byMail ? messages.code.titleEmail : messages.code.titleAuthenticator}
      </h2>
      <p className="text-petroleo/80">
        {byMail
          ? fill(messages.code.hintEmail, { email: challenge.email })
          : messages.code.hintAuthenticator}
      </p>
      <FormAlert text={error} />
      <CodeInput
        id={`${base}-code`}
        label={messages.code.label}
        value={code}
        onChange={setCode}
        busy={busy}
        submit={messages.code.submit}
        submitting={messages.code.submitting}
        before={
          byMail && (
            <div className="flex flex-col gap-1">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  aria-describedby={`${base}-remember-hint`}
                  className="size-5 accent-petroleo"
                />
                {messages.code.remember}
              </label>
              <p
                id={`${base}-remember-hint`}
                className="text-sm text-petroleo/80"
              >
                {messages.code.rememberHint}
              </p>
            </div>
          )
        }
      />
      <button type="button" onClick={onRestart} className={LINK_BUTTON}>
        {messages.code.restart}
      </button>
    </form>
  );
}

/** The QR code of an `otpauth://` URI, as an image the CSP allows (`img-src data:`). */
function qrImage(uri: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  return qr.createDataURL(5, 16);
}

/**
 * Staff and admin turn the authenticator on (T2.1a): the secret as a QR code, as text and as a
 * link for an app on the same device, then its first code. Confirming signs in.
 *
 * @param messages - `account` texts.
 * @param challengeId - The challenge that passed the mailed code.
 * @param onConfirmed - Called with the 8 backup codes, shown once.
 * @param onRestart - Back to the sign-in form.
 */
export function EnrollForm({
  messages,
  challengeId,
  onConfirmed,
  onRestart,
}: Readonly<{
  messages: AccountMessages;
  challengeId: string;
  onConfirmed: (backupCodes: string[]) => void;
  onRestart: () => void;
}>) {
  const base = useId();
  const [secret, setSecret] = useState<{
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void enroll(challengeId).then((result) => {
      if (!live) return;
      if (result.ok) setSecret(result.data);
      else setError(failureText(messages, result.reason));
    });
    return () => {
      live = false;
    };
  }, [challengeId, messages]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError(messages.errors.codeFormat);
      return;
    }
    setBusy(true);
    const result = await confirm({ challengeId, code });
    setBusy(false);
    if (result.ok) onConfirmed(result.data.backupCodes);
    else setError(failureText(messages, result.reason));
  }

  return (
    <form noValidate onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <h2 className="text-2xl font-semibold">{messages.enroll.title}</h2>
      <p className="text-petroleo/80">{messages.enroll.intro}</p>
      <FormAlert text={error} />
      {secret ? (
        <div className="flex flex-col gap-3">
          <p>{messages.enroll.scan}</p>
          <img
            src={qrImage(secret.otpauthUri)}
            alt={messages.enroll.qrAlt}
            width={200}
            height={200}
            className="rounded-md border border-petroleo/20 bg-white p-2"
          />
          <p className="text-sm">{messages.enroll.manual}</p>
          <code className="rounded-md bg-arena/40 px-3 py-2 font-mono break-all">
            {secret.secret}
          </code>
          <a href={secret.otpauthUri} className={LINK_BUTTON}>
            {messages.enroll.openApp}
          </a>
          <CodeInput
            id={`${base}-code`}
            label={messages.enroll.label}
            value={code}
            onChange={setCode}
            busy={busy}
            submit={messages.enroll.submit}
            submitting={messages.enroll.submitting}
          />
        </div>
      ) : (
        <output className="block">{messages.enroll.loading}</output>
      )}
      <button type="button" onClick={onRestart} className={LINK_BUTTON}>
        {messages.code.restart}
      </button>
    </form>
  );
}

/**
 * The 8 backup codes, shown this once after the authenticator is turned on.
 *
 * @param messages - `account` texts.
 * @param codes - The codes.
 * @param onContinue - The person saved them.
 */
export function BackupCodes({
  messages,
  codes,
  onContinue,
}: Readonly<{
  messages: AccountMessages;
  codes: readonly string[];
  onContinue: () => void;
}>) {
  return (
    <section className="flex max-w-md flex-col gap-4">
      <h2 className="text-2xl font-semibold">{messages.backup.title}</h2>
      <p className="text-petroleo/80">{messages.backup.intro}</p>
      <ul
        aria-label={messages.backup.listLabel}
        className="grid grid-cols-2 gap-2 font-mono"
      >
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-arena/40 px-3 py-2">
            {code}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onContinue} className={BUTTON}>
        {messages.backup.continue}
      </button>
    </section>
  );
}
