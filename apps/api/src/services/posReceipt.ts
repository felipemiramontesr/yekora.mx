/**
 * The thermal receipt of a counter sale (FC 076 F3, K-79): plain lines the width of 80 mm (42
 * characters) or 58 mm paper (32), with the lines sold, the VAT, how it was paid and the folio. A
 * card sale shows the terminal's authorization and the last four digits, never more (T0.1). It is
 * a sales receipt, not a CFDI.
 *
 * @module
 */
import type { z } from 'zod';
import type { receiptSchema } from '../../../../lib/account/posTypes';
import type { TxQuery } from './db';

/** Cents as the database or a driver may give them. */
type Cents = number | string | null;

/** Characters per line of each paper width. */
const COLUMNS = { 80: 42, 58: 32 } as const;

interface OrderRow {
  id: number;
  paid_at: Date;
  items_base_mxn_cents: number | string;
  items_tax_mxn_cents: number | string;
  total_mxn_cents: number | string;
  pos_tendered_mxn_cents: number | string | null;
  pos_change_mxn_cents: number | string | null;
  pos_terminal_auth_code: string | null;
  pos_terminal_last_four: string | null;
  pos_terminal_brand: string | null;
  pos_terminal_voucher_folio: string | null;
}

const money = (cents: Cents) => `$${(Number(cents) / 100).toFixed(2)}`;

/** Two texts on one line, the second against the right edge. */
function row(left: string, right: string, width: number): string {
  const room = Math.max(1, width - right.length - 1);
  return `${left.slice(0, room).padEnd(room)} ${right}`;
}

const centered = (text: string, width: number) =>
  `${' '.repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`;

/** How the sale was paid, as lines of the receipt. */
function payment(order: OrderRow, width: number): string[] {
  if (order.pos_terminal_last_four === null) {
    return [
      row('Efectivo recibido', money(order.pos_tendered_mxn_cents), width),
      row('Cambio', money(order.pos_change_mxn_cents), width),
    ];
  }
  return [
    `Terminal Banorte · ${order.pos_terminal_brand}`,
    `Tarjeta **** ${order.pos_terminal_last_four}`,
    `Autorizacion ${order.pos_terminal_auth_code}`,
    `Folio ${order.pos_terminal_voucher_folio}`,
  ];
}

/**
 * The receipt of a counter sale.
 *
 * @param db - Database port.
 * @param orderNumber - The order of the sale.
 * @param widthMm - Paper width, 80 or 58.
 * @returns The lines, or null when no counter sale has that number.
 */
export async function posReceipt(
  db: TxQuery,
  orderNumber: string,
  widthMm: 80 | 58
): Promise<z.infer<typeof receiptSchema> | null> {
  const [order] = await db.query<OrderRow>(
    "SELECT id, paid_at, items_base_mxn_cents, items_tax_mxn_cents, total_mxn_cents, pos_tendered_mxn_cents, pos_change_mxn_cents, pos_terminal_auth_code, pos_terminal_last_four, pos_terminal_brand, pos_terminal_voucher_folio FROM orders WHERE order_number = ? AND channel = 'pos'",
    [orderNumber]
  );
  if (order === undefined) return null;
  const items = await db.query<{
    sku: string;
    name_es: string;
    quantity: number;
    line_total_mxn_cents: number | string;
  }>(
    'SELECT i.sku, p.name_es, i.quantity, i.line_total_mxn_cents FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id',
    [order.id]
  );
  const width = COLUMNS[widthMm];
  const rule = '-'.repeat(width);
  const date = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date(order.paid_at));
  return {
    orderNumber,
    widthMm,
    lines: [
      centered('YEKORA', width),
      centered('Comprobante de venta', width),
      rule,
      `Folio ${orderNumber}`,
      date,
      rule,
      ...items.flatMap((item) => [
        item.name_es.slice(0, width),
        row(
          `${item.quantity} x ${item.sku}`,
          money(item.line_total_mxn_cents),
          width
        ),
      ]),
      rule,
      row('Subtotal', money(order.items_base_mxn_cents), width),
      row('IVA 16%', money(order.items_tax_mxn_cents), width),
      row('TOTAL', money(order.total_mxn_cents), width),
      rule,
      ...payment(order, width),
      rule,
      centered('No es comprobante fiscal', width),
      centered('Devoluciones: 60 dias naturales', width),
    ],
  };
}
