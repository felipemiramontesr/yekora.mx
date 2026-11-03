'use client';

import { type MouseEvent, useEffect, useId, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import type { OrderDetail, OrderSummary } from '@/lib/account/orderTypes';
import {
  type AccountFailure,
  listOrders,
  type OrderScope,
  readOrder,
} from '@/lib/api/accountClient';
import { fill, formatMoney } from '@/lib/catalog/format';
import { ORDER_STATUS_CODES } from '@/lib/checkout/checkoutTypes';
import { FormAlert, failureText } from './AccountForms';

/** The texts the order views read. */
interface OrderTexts {
  account: Messages['account'];
  methods: Messages['checkout']['method']['options'];
}

/** What loading an order view gave. */
type Load<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T }
  | { kind: 'failed'; reason: AccountFailure };

const PAGE_SIZE = 20;

/** A date and time in Mexico City, where the store and its buyers are. */
function when(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(iso));
}

/** A link that navigates inside the area without reloading the page. */
function InAreaLink({
  href,
  onNavigate,
  className,
  children,
  label,
}: Readonly<{
  href: string;
  onNavigate: () => void;
  className: string;
  children: string;
  label?: string;
}>) {
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onNavigate();
  };
  return (
    <a href={href} onClick={go} aria-label={label} className={className}>
      {children}
    </a>
  );
}

/**
 * One page of orders, newest first, with paging and, in the panel, a status filter.
 *
 * @param scope - The buyer's own orders, or the panel's.
 * @param locale - Language of the page.
 * @param texts - `account` texts and the payment method names.
 * @param hrefOf - Path of an order (for the link).
 * @param onOpen - Opens an order inside the area.
 */
export function OrderList({
  scope,
  locale,
  texts,
  hrefOf,
  onOpen,
}: Readonly<{
  scope: OrderScope;
  locale: Locale;
  texts: OrderTexts;
  hrefOf: (orderNumber: string) => string;
  onOpen: (orderNumber: string) => void;
}>) {
  const base = useId();
  const { account } = texts;
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [load, setLoad] = useState<
    Load<{ items: OrderSummary[]; total: number }>
  >({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    void listOrders(scope, { page, status }).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { kind: 'ready', data: result.data }
          : { kind: 'failed', reason: result.reason }
      );
    });
    return () => {
      live = false;
    };
  }, [scope, page, status]);

  const pages =
    load.kind === 'ready'
      ? Math.max(1, Math.ceil(load.data.total / PAGE_SIZE))
      : 1;
  return (
    <section className="flex flex-col gap-4">
      {scope === 'admin' && (
        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor={`${base}-status`} className="text-sm font-medium">
            {account.orders.filter}
          </label>
          <select
            id={`${base}-status`}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3"
          >
            <option value="">{account.orders.allStatuses}</option>
            {ORDER_STATUS_CODES.map((code) => (
              <option key={code} value={code}>
                {account.statuses[code]}
              </option>
            ))}
          </select>
        </div>
      )}
      {load.kind === 'loading' && (
        <output className="block">{account.orders.loading}</output>
      )}
      {load.kind === 'failed' && (
        <FormAlert text={failureText(account, load.reason)} />
      )}
      {load.kind === 'ready' && load.data.items.length === 0 && (
        <p>
          {scope === 'admin' ? account.orders.emptyPanel : account.orders.empty}
        </p>
      )}
      {load.kind === 'ready' && load.data.items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">{account.orders.caption}</caption>
              <thead>
                <tr className="border-b border-petroleo/20">
                  <th scope="col" className="py-2 pr-4">
                    {account.orders.number}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {account.orders.date}
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    {account.orders.status}
                  </th>
                  <th scope="col" className="py-2 text-right">
                    {account.orders.total}
                  </th>
                </tr>
              </thead>
              <tbody>
                {load.data.items.map((order) => (
                  <tr
                    key={order.orderNumber}
                    className="border-b border-petroleo/10"
                  >
                    <td className="py-2 pr-4">
                      <InAreaLink
                        href={hrefOf(order.orderNumber)}
                        onNavigate={() => onOpen(order.orderNumber)}
                        label={fill(account.orders.open, {
                          number: order.orderNumber,
                        })}
                        className="tap-target font-mono underline underline-offset-4"
                      >
                        {order.orderNumber}
                      </InAreaLink>
                      {order.isTest && (
                        <span className="ml-2 rounded bg-arena/40 px-2 text-xs">
                          {account.orders.test}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {when(order.createdAt, locale)}
                    </td>
                    <td className="py-2 pr-4">
                      {account.statuses[order.status]}
                    </td>
                    <td className="py-2 text-right">
                      {formatMoney(order.totalMxnCents, 'MXN', locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav
            aria-label={fill(account.orders.page, { page, pages })}
            className="flex items-center gap-4"
          >
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="tap-target underline underline-offset-4 disabled:no-underline disabled:opacity-50"
            >
              {account.orders.previous}
            </button>
            <span className="text-sm">
              {fill(account.orders.page, { page, pages })}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              className="tap-target underline underline-offset-4 disabled:no-underline disabled:opacity-50"
            >
              {account.orders.next}
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

/** One label and value of the order's summary. */
function Fact({ term, value }: Readonly<{ term: string; value: string }>) {
  return (
    <div className="flex justify-between gap-4 border-b border-petroleo/10 py-1">
      <dt className="text-petroleo/80">{term}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** The detail of a loaded order: summary, lines and payment events. */
function OrderFacts({
  order,
  locale,
  texts,
}: Readonly<{ order: OrderDetail; locale: Locale; texts: OrderTexts }>) {
  const { orders, statuses } = texts.account;
  const money = (cents: number) => formatMoney(cents, 'MXN', locale);
  return (
    <>
      <dl className="max-w-lg">
        <Fact term={orders.status} value={statuses[order.status]} />
        <Fact term={orders.method} value={texts.methods[order.method].label} />
        <Fact term={orders.placed} value={when(order.createdAt, locale)} />
        {order.paidAt === null ? (
          <Fact term={orders.expiresAt} value={when(order.expiresAt, locale)} />
        ) : (
          <Fact term={orders.paidAt} value={when(order.paidAt, locale)} />
        )}
        <Fact
          term={orders.itemsTotal}
          value={money(order.itemsTotalMxnCents)}
        />
        <Fact
          term={orders.shipping}
          value={money(order.shippingTotalMxnCents)}
        />
        <Fact term={orders.total} value={money(order.totalMxnCents)} />
      </dl>
      <h3 className="mt-4 text-lg font-semibold">{orders.lines}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead>
            <tr className="border-b border-petroleo/20">
              <th scope="col" className="py-2 pr-4">
                {orders.sku}
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                {orders.quantity}
              </th>
              <th scope="col" className="py-2 pr-4 text-right">
                {orders.unitPrice}
              </th>
              <th scope="col" className="py-2 text-right">
                {orders.lineTotal}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.sku} className="border-b border-petroleo/10">
                <td className="py-2 pr-4 font-mono">{line.sku}</td>
                <td className="py-2 pr-4 text-right">{line.quantity}</td>
                <td className="py-2 pr-4 text-right">
                  {money(line.unitPriceMxnCents)}
                </td>
                <td className="py-2 text-right">
                  {money(line.lineTotalMxnCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mt-4 text-lg font-semibold">{orders.payments}</h3>
      {order.paymentEvents.length === 0 ? (
        <p>{orders.noPayments}</p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {order.paymentEvents.map((event) => (
            <li
              key={`${event.receivedAt}-${event.eventType}`}
              className="rounded-md border border-petroleo/20 p-3"
            >
              <p className="font-medium">
                {when(event.receivedAt, locale)} · {event.processor} ·{' '}
                {event.eventType}
              </p>
              <p>
                {orders.result}:{' '}
                {event.resultingStatus
                  ? statuses[event.resultingStatus]
                  : orders.noChange}
                {event.amountMxnCents !== null &&
                  ` · ${orders.amount}: ${money(event.amountMxnCents)}`}
              </p>
              {event.isAlert && (
                <p className="font-medium text-red-800">{orders.alert}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * One order with its lines and payment events, read-only.
 *
 * @param scope - The buyer's own order, or any order for the panel.
 * @param orderNumber - Which order.
 * @param locale - Language of the page.
 * @param texts - `account` texts and the payment method names.
 * @param backHref - Path of the list.
 * @param onBack - Back to the list inside the area.
 */
export function OrderDetailView({
  scope,
  orderNumber,
  locale,
  texts,
  backHref,
  onBack,
}: Readonly<{
  scope: OrderScope;
  orderNumber: string;
  locale: Locale;
  texts: OrderTexts;
  backHref: string;
  onBack: () => void;
}>) {
  const { account } = texts;
  const [load, setLoad] = useState<Load<OrderDetail>>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    setLoad({ kind: 'loading' });
    void readOrder(scope, orderNumber).then((result) => {
      if (!live) return;
      setLoad(
        result.ok
          ? { kind: 'ready', data: result.data }
          : { kind: 'failed', reason: result.reason }
      );
    });
    return () => {
      live = false;
    };
  }, [scope, orderNumber]);

  return (
    <section className="flex flex-col gap-4">
      <InAreaLink
        href={backHref}
        onNavigate={onBack}
        className="tap-target self-start underline underline-offset-4"
      >
        {account.orders.back}
      </InAreaLink>
      <h2 className="text-2xl font-semibold">
        {fill(account.orders.detailTitle, { number: orderNumber })}
      </h2>
      {load.kind === 'loading' && (
        <output className="block">{account.orders.loading}</output>
      )}
      {load.kind === 'failed' && (
        <FormAlert text={failureText(account, load.reason)} />
      )}
      {load.kind === 'ready' && (
        <OrderFacts order={load.data} locale={locale} texts={texts} />
      )}
    </section>
  );
}
