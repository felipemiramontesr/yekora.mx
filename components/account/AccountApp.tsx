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
import { forgetDevice, logout, me } from '@/lib/api/accountClient';
import { fill } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';
import {
  BackupCodes,
  type Channel,
  CodeForm,
  EnrollForm,
  failureText,
  RegisterForm,
  SignInForm,
} from './AccountForms';
import { OrderDetailView, OrderList } from './AccountOrders';
import type { CatalogTexts } from './catalog/catalogTexts';

/**
 * The catalog console, in its own chunk (FC 043 T1.3, T2.4): only an account with
 * `catalog:write` opens it, so buyers never download it with `/cuenta/`. `ssr: false` because it
 * only ever renders after sign-in, in the browser. While the chunk arrives the panel stays empty
 * under the tabs (a placeholder could not be localized: `loading` gets no props); once loaded, the
 * console shows its own «Cargando…» until the API answers.
 */
const CatalogConsole = dynamic<{ texts: CatalogTexts }>(
  () =>
    import('./catalog/CatalogConsole').then((module) => module.CatalogConsole),
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
  | { kind: 'code'; challengeId: string; channel: Channel; email: string }
  | { kind: 'enroll'; challengeId: string }
  | { kind: 'backup'; codes: string[] }
  | { kind: 'signedIn'; user: MeResponse };

/** The permission that opens the panel's orders. */
const PANEL_PERMISSION = 'orders:read';

/** The permission that opens the catalog console (FC 029 F3). */
const CATALOG_PERMISSION = 'catalog:write';

const signedOut = (notice: string | null = null): Stage => ({
  kind: 'signIn',
  email: '',
  notice,
});

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
        setStage({ kind: 'signedIn', user: result.data });
        return;
      }
      // Signed out is the usual answer; anything else is worth saying.
      const quiet = result.reason === 'SESSION_INVALID_OR_EXPIRED';
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
    const read = () =>
      setView(parseAccountPath(globalThis.location.pathname, area));
    read();
    void loadSession(true);
    globalThis.addEventListener('popstate', read);
    return () => globalThis.removeEventListener('popstate', read);
  }, [area, loadSession]);

  const navigate = (next: AccountView) => {
    globalThis.history.pushState(null, '', accountPath(area, next));
    setView(next);
  };

  async function signOut() {
    await logout();
    navigate({ tab: 'orders', orderNumber: null });
    setStage(signedOut());
  }

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
          onSignOut={signOut}
        />
      )}
    </div>
  );
}

/** The signed-in area: greeting, sign-out, the tabs and the open list or order. */
function Dashboard({
  locale,
  area,
  user,
  view,
  texts,
  onNavigate,
  onSignOut,
}: Readonly<{
  locale: Locale;
  area: string;
  user: MeResponse;
  view: AccountView;
  texts: { account: Messages['account']; methods: AccountAppProps['methods'] };
  onNavigate: (view: AccountView) => void;
  onSignOut: () => Promise<void>;
}>) {
  const { dashboard } = texts.account;
  const [leaving, setLeaving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  // A tab is offered only with its permission; the API would refuse it anyway.
  const tabs = (['orders', 'panel', 'catalog'] as const).filter(
    (name) =>
      name === 'orders' ||
      user.permissions.includes(
        name === 'panel' ? PANEL_PERMISSION : CATALOG_PERMISSION
      )
  );
  const tab = tabs.includes(view.tab) ? view.tab : 'orders';
  const scope = tab === 'panel' ? 'admin' : 'account';
  const open = (orderNumber: string | null) => onNavigate({ tab, orderNumber });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xl font-semibold">
          {fill(dashboard.greeting, { name: user.fullName })}
        </p>
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void onSignOut();
          }}
          className="tap-target underline underline-offset-4"
        >
          {leaving ? dashboard.signingOut : dashboard.signOut}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={forgetting}
          onClick={() => {
            setForgetting(true);
            void forgetDevice().then((result) => {
              setForgetting(false);
              setDeviceNote(
                result.ok
                  ? dashboard.deviceForgotten
                  : failureText(texts.account, result.reason)
              );
            });
          }}
          className="tap-target self-start text-sm underline underline-offset-4"
        >
          {forgetting ? dashboard.forgettingDevice : dashboard.forgetDevice}
        </button>
        {deviceNote && <output className="block text-sm">{deviceNote}</output>}
      </div>
      <nav aria-label={dashboard.tabsLabel}>
        <ul className="flex gap-6 border-b border-petroleo/20">
          {tabs.map((name) => (
            <li key={name}>
              <a
                href={accountPath(area, { tab: name, orderNumber: null })}
                aria-current={tab === name ? 'page' : undefined}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onNavigate({ tab: name, orderNumber: null });
                }}
                className="tap-target font-medium aria-[current=page]:border-b-2 aria-[current=page]:border-petroleo"
              >
                {dashboard[name]}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'catalog' && <CatalogConsole texts={texts.account.catalog} />}
      {tab !== 'catalog' && view.orderNumber && (
        <OrderDetailView
          scope={scope}
          orderNumber={view.orderNumber}
          locale={locale}
          texts={texts}
          backHref={accountPath(area, { tab, orderNumber: null })}
          onBack={() => open(null)}
        />
      )}
      {tab !== 'catalog' && !view.orderNumber && (
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
