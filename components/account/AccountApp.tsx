'use client';

import dynamic from 'next/dynamic';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import {
  type AccountView,
  accountPath,
  parseAccountPath,
} from '@/lib/account/accountPaths';
import type { MeResponse } from '@/lib/account/authTypes';
import {
  clearSessionFirstName,
  firstNameOf,
  readSessionFirstName,
  saveSessionFirstName,
  subscribeSessionHint,
} from '@/lib/account/sessionHint';
import { me } from '@/lib/api/accountClient';
import { sectionsOf } from '@/lib/account/sections';
import { fill } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';
import {
  BackupCodes,
  type Channel,
  CodeForm,
  EnrollForm,
  failureText,
  ForgotForm,
  RegisterForm,
  ResetForm,
  SignInForm,
} from './AccountForms';
import { OrderDetailView, OrderList } from './AccountOrders';
import type { AdminUsersTexts } from './AdminUsersConsole';
import type { CatalogTexts } from './catalog/catalogTexts';

/**
 * The catalog console, in its own chunk (FC 043 T1.3, T2.4): only an account with
 * `catalog:write` opens it, so buyers never download it with `/cuenta/`. `ssr: false` because it
 * only ever renders after sign-in, in the browser. While the chunk arrives the panel stays empty
 * under the tabs (a placeholder could not be localized: `loading` gets no props); once loaded, the
 * console shows its own «Cargando…» until the API answers.
 */
const CatalogConsole = dynamic<{ texts: CatalogTexts; locale: Locale }>(
  () =>
    import('./catalog/CatalogConsole').then((module) => module.CatalogConsole),
  { ssr: false }
);

/**
 * The administrators console, in its own chunk too (FC 044 F2): only the owner opens it, so
 * nobody else downloads it with `/cuenta/`.
 */
const AdminUsersConsole = dynamic<{ texts: AdminUsersTexts }>(
  () =>
    import('./AdminUsersConsole').then((module) => module.AdminUsersConsole),
  { ssr: false }
);

/** Props of {@link AccountApp}. */
interface AccountAppProps {
  /** Language of the page. */
  locale: Locale;
  /** `account` texts. */
  messages: Messages['account'];
  /** Payment method names (`checkout.method.options`). */
  methods: Messages['checkout']['method']['options'];
}

/** Where the person stands in the area. */
type Stage =
  | { kind: 'signIn'; email: string; notice: string | null }
  | { kind: 'register' }
  | { kind: 'forgot'; email: string }
  | { kind: 'reset'; token: string }
  | { kind: 'code'; challengeId: string; channel: Channel; email: string }
  | { kind: 'enroll'; challengeId: string }
  | { kind: 'backup'; codes: string[] }
  | { kind: 'signedIn'; user: MeResponse };

const signedOut = (notice: string | null = null): Stage => ({
  kind: 'signIn',
  email: '',
  notice,
});

/** Whether the address asks for the sign-up form (`?action=register`, FC 047): the header's «Crear cuenta». */
function registerRequested(search: string): boolean {
  return new URLSearchParams(search).get('action') === 'register';
}

/** The token of a mailed reset link (FC 042): `?action=reset-password&token=<64 hex>`. */
const RESET_TOKEN = /^[0-9a-f]{64}$/;

/**
 * The reset token the address carries, if any.
 *
 * @param search - `location.search`.
 * @returns The token, or null.
 */
function resetTokenOf(search: string): string | null {
  const query = new URLSearchParams(search);
  const token = query.get('token') ?? '';
  return query.get('action') === 'reset-password' && RESET_TOKEN.test(token)
    ? token
    : null;
}

/**
 * The account area (FC 028 F2, ADR 0011): one client-rendered page that signs the person in
 * (password, then the mailed code or the authenticator; staff enrol the authenticator the first
 * time) and then shows their orders and, with `orders:read`, the panel's. The API decides every
 * access (143_AN B4); this page only shows what the API answered. Sub-paths name the open view
 * (lib/account/accountPaths.ts), so an order can be linked and the back button works.
 */
export function AccountApp({
  locale,
  messages,
  methods,
}: Readonly<AccountAppProps>) {
  const area = routeFor('account', locale);
  // The sign-in form is what almost every visitor needs, so it is in the prerendered page and
  // shows at once; the session is checked behind it and replaces it only when there is one.
  // Waiting for the API first made the page jump from a loading line to the form, seconds
  // later when Hostinger had put the API to sleep.
  const [stage, setStage] = useState<Stage>(() => signedOut());
  const [view, setView] = useState<AccountView>({
    tab: 'orders',
    orderNumber: null,
  });

  /**
   * Asks the API who is signed in. The first check runs behind the form: when it finds no
   * session, it only touches a sign-in form still waiting, never someone who has meanwhile moved
   * on to the code or to sign-up (the API may answer seconds later, after a cold start).
   */
  const loadSession = useCallback(
    async (behindForm = false) => {
      const result = await me();
      if (result.ok) {
        // FC 046: the header greets by this first name; the API stays the proof.
        saveSessionFirstName(firstNameOf(result.data.fullName));
        setStage({ kind: 'signedIn', user: result.data });
        return;
      }
      // Signed out is the usual answer; anything else is worth saying.
      const quiet = result.reason === 'SESSION_INVALID_OR_EXPIRED';
      if (quiet) clearSessionFirstName();
      const next = signedOut(
        quiet ? null : failureText(messages, result.reason)
      );
      setStage((current) =>
        behindForm && current.kind !== 'signIn' ? current : next
      );
    },
    [messages]
  );

  useEffect(() => {
    const read = () => {
      setView(parseAccountPath(globalThis.location.pathname, area));
      // FC 047: «Crear cuenta» of the header, from inside the area, asks for the sign-up form.
      if (registerRequested(globalThis.location.search)) {
        globalThis.history.replaceState(null, '', area);
        setStage((current) =>
          current.kind === 'signIn' ? { kind: 'register' } : current
        );
      }
    };
    read();
    // FC 042: a mailed reset link opens the new-password form. Its token leaves the address bar
    // at once, so it stays out of the history, of a shared screen and of any Referer.
    const token = resetTokenOf(globalThis.location.search);
    if (token === null) {
      void loadSession(true);
    } else {
      globalThis.history.replaceState(null, '', area);
      setStage({ kind: 'reset', token });
    }
    globalThis.addEventListener('popstate', read);
    // FC 046: signing out from the header, or from another tab, erases the hint; this area then
    // shows the sign-in form instead of a session that no longer exists.
    const unsubscribe = subscribeSessionHint(() => {
      if (readSessionFirstName() === null) {
        setStage((current) =>
          current.kind === 'signedIn' ? signedOut() : current
        );
      }
    });
    return () => {
      globalThis.removeEventListener('popstate', read);
      unsubscribe();
    };
  }, [area, loadSession]);

  const navigate = (next: AccountView) => {
    globalThis.history.pushState(null, '', accountPath(area, next));
    setView(next);
  };

  return (
    <div className="flex flex-col gap-6">
      {stage.kind === 'signIn' && (
        <SignInForm
          messages={messages}
          initialEmail={stage.email}
          notice={stage.notice}
          onChallenge={(challenge) => setStage({ kind: 'code', ...challenge })}
          onSignedIn={() => void loadSession()}
          onRegister={() => setStage({ kind: 'register' })}
          onForgot={(email) => setStage({ kind: 'forgot', email })}
        />
      )}
      {stage.kind === 'forgot' && (
        <ForgotForm
          messages={messages}
          initialEmail={stage.email}
          onSignIn={() => setStage(signedOut())}
        />
      )}
      {stage.kind === 'reset' && (
        <ResetForm
          messages={messages}
          token={stage.token}
          onDone={() => setStage(signedOut(messages.reset.done))}
          onForgot={() => setStage({ kind: 'forgot', email: '' })}
        />
      )}
      {stage.kind === 'register' && (
        <RegisterForm
          messages={messages}
          onRegistered={(email) =>
            setStage({
              kind: 'signIn',
              email,
              notice: messages.register.accepted,
            })
          }
          onSignIn={() => setStage(signedOut())}
        />
      )}
      {stage.kind === 'code' && (
        <CodeForm
          messages={messages}
          challenge={stage}
          onSignedIn={() => void loadSession()}
          onEnroll={() =>
            setStage({ kind: 'enroll', challengeId: stage.challengeId })
          }
          onRestart={() => setStage(signedOut())}
        />
      )}
      {stage.kind === 'enroll' && (
        <EnrollForm
          messages={messages}
          challengeId={stage.challengeId}
          onConfirmed={(codes) => setStage({ kind: 'backup', codes })}
          onRestart={() => setStage(signedOut())}
        />
      )}
      {stage.kind === 'backup' && (
        <BackupCodes
          messages={messages}
          codes={stage.codes}
          onContinue={() => void loadSession()}
        />
      )}
      {stage.kind === 'signedIn' && (
        <Dashboard
          locale={locale}
          area={area}
          user={stage.user}
          view={view}
          texts={{ account: messages, methods }}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}

/**
 * The signed-in area (FC 047 T2.5): where the person is, and the open list or order. The sections
 * themselves, with sign-out and the language, live in the account menu of the header, so the area
 * has no navigation of its own; it only says where you are: the greeting, and a breadcrumb
 * («Mi cuenta › section») whose first step returns to the orders.
 */
function Dashboard({
  locale,
  area,
  user,
  view,
  texts,
  onNavigate,
}: Readonly<{
  locale: Locale;
  area: string;
  user: MeResponse;
  view: AccountView;
  texts: { account: Messages['account']; methods: AccountAppProps['methods'] };
  onNavigate: (view: AccountView) => void;
}>) {
  const { dashboard } = texts.account;
  // A tab is offered only with its permission or role; the API would refuse it anyway.
  const tabs = sectionsOf(user);
  const tab = tabs.includes(view.tab) ? view.tab : 'orders';
  const scope = tab === 'panel' ? 'admin' : 'account';
  const isOrders = tab === 'orders' || tab === 'panel';
  const open = (orderNumber: string | null) => onNavigate({ tab, orderNumber });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <nav aria-label={dashboard.breadcrumb}>
          <ol className="flex flex-wrap items-center gap-2 text-sm text-petroleo/80">
            <li>
              <a
                href={accountPath(area, { tab: 'orders', orderNumber: null })}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onNavigate({ tab: 'orders', orderNumber: null });
                }}
                className="tap-target underline underline-offset-4"
              >
                {texts.account.title}
              </a>
            </li>
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="font-semibold text-petroleo">
              {dashboard[tab]}
            </li>
          </ol>
        </nav>
        <p className="text-xl font-semibold">
          {fill(dashboard.greeting, { name: user.fullName })}
        </p>
      </div>
      {tab === 'catalog' && (
        <CatalogConsole texts={texts.account.catalog} locale={locale} />
      )}
      {tab === 'admins' && <AdminUsersConsole texts={texts.account.admins} />}
      {isOrders && view.orderNumber && (
        <OrderDetailView
          scope={scope}
          orderNumber={view.orderNumber}
          locale={locale}
          texts={texts}
          backHref={accountPath(area, { tab, orderNumber: null })}
          onBack={() => open(null)}
        />
      )}
      {isOrders && !view.orderNumber && (
        <OrderList
          key={scope}
          scope={scope}
          locale={locale}
          texts={texts}
          hrefOf={(orderNumber) => accountPath(area, { tab, orderNumber })}
          onOpen={open}
        />
      )}
    </div>
  );
}
