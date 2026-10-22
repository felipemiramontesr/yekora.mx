'use client';

import { useEffect, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { fetchOrder } from '@/lib/api/checkoutClient';
import { getCartStore } from '@/lib/cart/cartStore';
import type { OrderView } from '@/lib/checkout/checkoutTypes';
import { isGatewayUrl } from '@/lib/checkout/gateway';
import { type OrderAccess, recallOrder } from '@/lib/checkout/orderAccess';
import { fill, formatMoney } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';

/** Which return page shows the order. */
type Variant = 'success' | 'cancel';

/** Props of {@link OrderStatus}. */
interface OrderStatusProps {
  /** Language of the page. */
  locale: Locale;
  /** The processor sent the buyer back after paying (`success`) or after leaving (`cancel`). */
  variant: Variant;
  /** `checkout` texts. */
  messages: Messages['checkout'];
}

type View =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; access: OrderAccess }
  | { kind: 'ready'; access: OrderAccess; order: OrderView };

/** Methods settled while the buyer waits: the page asks again until the webhook lands. */
const INSTANT = new Set(['CARD', 'MERCADO_PAGO_BALANCE']);
const POLL_MS = 4000;
const MAX_POLLS = 15;

/** The payment deadline in Mexico City time, where the store and its buyers are. */
function deadline(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(iso));
}

/**
 * The order on the return pages (FC 012 F3). It reads the order this tab placed with its token
 * (session storage, sent in `Authorization`), and says where it stands:
 *
 * - pending after an instant method: it asks again every 4 s for a minute, until the
 *   processor's notification settles it;
 * - pending after OXXO or SPEI, or back from the cancel page: the deadline and a way back to the
 *   same payment page, instead of a second order that would hold the stock twice;
 * - any other status: what happened, in plain words.
 *
 * Back from paying, the cart is emptied once the order exists (pending or paid).
 */
export function OrderStatus({
  locale,
  variant,
  messages,
}: Readonly<OrderStatusProps>) {
  const texts = messages.return;
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const access = recallOrder();
    if (access === null) {
      setView({ kind: 'missing' });
      return;
    }
    let live = true;
    void fetchOrder(access).then((result) => {
      if (!live) return;
      setView(
        result.ok
          ? { kind: 'ready', access, order: result.order }
          : { kind: 'failed', access }
      );
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const order = view.kind === 'ready' ? view.order : null;
  const pending = order?.status === 'PENDING_PAYMENT';
  const polling =
    variant === 'success' &&
    pending &&
    INSTANT.has(order.method) &&
    attempt < MAX_POLLS;

  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [polling, attempt]);

  useEffect(() => {
    if (
      variant === 'success' &&
      (order?.status === 'PENDING_PAYMENT' || order?.status === 'PAID')
    ) {
      getCartStore().clearCart();
    }
  }, [variant, order?.status]);

  if (view.kind === 'loading') {
    return <p aria-live="polite">{texts.loading}</p>;
  }
  if (view.kind === 'missing') {
    return <ReturnLinks locale={locale} texts={texts} lead={texts.missing} />;
  }
  if (view.kind === 'failed') {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert">{texts.failed}</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="min-h-11 rounded-md border border-petroleo px-6 font-semibold"
        >
          {texts.retry}
        </button>
      </div>
    );
  }
  return (
    <OrderDetails
      locale={locale}
      variant={variant}
      access={view.access}
      order={view.order}
      polling={polling}
      messages={messages}
    />
  );
}

/** Props of {@link OrderDetails}. */
interface OrderDetailsProps {
  locale: Locale;
  variant: Variant;
  access: OrderAccess;
  order: OrderView;
  polling: boolean;
  messages: Messages['checkout'];
}

function OrderDetails({
  locale,
  variant,
  access,
  order,
  polling,
  messages,
}: Readonly<OrderDetailsProps>) {
  const texts = messages.return;
  const pending = order.status === 'PENDING_PAYMENT';
  const resumable = pending && isGatewayUrl(access.redirectUrl);
  // Back from the cancel page, a pending order is not "waiting for confirmation": it is unpaid.
  const lead =
    variant === 'cancel' && pending ? null : texts.status[order.status];
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm font-medium text-petroleo/80">
        {fill(texts.order, { number: order.orderNumber })}
      </p>
      <div aria-live="polite" className="flex flex-col gap-2">
        {lead && <p className="text-lg">{lead}</p>}
        {polling && (
          <p className="text-sm text-petroleo/80">{texts.confirming}</p>
        )}
        {pending && !polling && (
          <p>
            {fill(texts.payBefore, { date: deadline(order.expiresAt, locale) })}
          </p>
        )}
      </div>
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        <dt>{texts.method}</dt>
        <dd className="text-right">
          {messages.method.options[order.method].label}
        </dd>
        <dt>{texts.items}</dt>
        <dd className="text-right">
          {formatMoney(order.itemsTotalMxnCents, 'MXN', locale)}
        </dd>
        <dt>{texts.shipping}</dt>
        <dd className="text-right">
          {formatMoney(order.shippingTotalMxnCents, 'MXN', locale)}
        </dd>
        <dt className="border-t border-petroleo/15 pt-2 font-semibold">
          {texts.total}
        </dt>
        <dd className="border-t border-petroleo/15 pt-2 text-right font-semibold">
          {formatMoney(order.totalMxnCents, 'MXN', locale)}
        </dd>
      </dl>
      {resumable && (
        <button
          type="button"
          onClick={() => globalThis.location.assign(access.redirectUrl)}
          className="min-h-11 self-start rounded-md bg-petroleo px-6 font-semibold text-marfil"
        >
          {texts.resume}
        </button>
      )}
      <ReturnLinks locale={locale} texts={texts} />
    </div>
  );
}

/** Ways on from a return page: the catalog and the cart, after an optional lead sentence. */
function ReturnLinks({
  locale,
  texts,
  lead,
}: Readonly<{
  locale: Locale;
  texts: Messages['checkout']['return'];
  lead?: string;
}>) {
  return (
    <div className="flex flex-col items-start gap-4">
      {lead && <p>{lead}</p>}
      <div className="flex flex-wrap gap-4">
        <a
          href={routeFor('catalog', locale)}
          className="inline-flex min-h-11 items-center rounded-md bg-petroleo px-6 font-semibold text-marfil"
        >
          {texts.toCatalog}
        </a>
        <a
          href={routeFor('cart', locale)}
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {texts.toCart}
        </a>
      </div>
    </div>
  );
}
