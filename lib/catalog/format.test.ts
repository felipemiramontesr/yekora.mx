import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import fixture from '@/e2e/fixtures/catalog.json';
import { fill, priceNote, priceText } from './format';
import { parseSnapshot } from './snapshot';

const snapshot = parseSnapshot(fixture);
const [harness] = snapshot.products.en;
const en = getMessages('en').catalog.price;

describe('fill', () => {
  it('replaces known placeholders and leaves unknown ones visible', () => {
    expect(fill('{count} products in {place}', { count: 3 })).toBe(
      '3 products in {place}'
    );
  });
});

describe('priceText', () => {
  it('adds the USD reference in English (Ω decision), currency spelled out', () => {
    expect(priceText(harness, 'en')).toEqual({
      mxn: '$4,850.00 MXN',
      usd: '$262.16 USD',
    });
  });

  it('keeps cents exact on small amounts', () => {
    expect(
      priceText({ ...harness, priceMxnCents: 5, priceUsdCents: 0 }, 'en')
    ).toEqual({ mxn: '$0.05 MXN', usd: '$0.00 USD' });
  });

  it('shows pesos only in Spanish', () => {
    expect(priceText(snapshot.products['es-MX'][0], 'es-MX')).toEqual({
      mxn: '$4,850.00 MXN',
      usd: null,
    });
  });

  it('shows pesos only without a FIX', () => {
    expect(priceText({ ...harness, priceUsdCents: null }, 'en').usd).toBeNull();
  });
});

describe('priceNote', () => {
  it('names the FIX, its date in words and its rate in English', () => {
    expect(priceNote(en, snapshot.exchangeRate, 'en')).toBe(
      "US dollar reference at Banxico's FIX exchange rate of October 16, 2026 (18.5000 MXN per USD). You pay in Mexican pesos."
    );
  });

  it('never shifts the Banxico date by time zone', () => {
    expect(
      priceNote(
        en,
        { series: 'SF43718', date: '2026-01-01', rate: '17.0000' },
        'en'
      )
    ).toContain('January 1, 2026');
  });

  it('says prices are in pesos in Spanish or without a FIX', () => {
    expect(
      priceNote(
        getMessages('es-MX').catalog.price,
        snapshot.exchangeRate,
        'es-MX'
      )
    ).toBe('Precios en pesos mexicanos (MXN).');
    expect(priceNote(en, null, 'en')).toBe('Prices in Mexican pesos (MXN).');
  });
});
