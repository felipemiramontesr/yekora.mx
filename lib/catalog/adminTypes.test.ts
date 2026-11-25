import { describe, expect, it } from 'vitest';
import { adminProductSchema, productCreate, productPatch } from './adminTypes';

const BASE = {
  sku: 'PACK-30',
  slug: 'mochila-30',
  nameEs: 'Mochila',
  nameEn: 'Backpack',
  descriptionEs: 'Ligera.',
  descriptionEn: 'Light.',
  priceMxnCents: 185000,
  stock: 4,
  discipline: 'montana',
  shippingClass: 'estandar',
  weightGrams: 900,
  lengthMm: 500,
  widthMm: 300,
  heightMm: 200,
  images: [{ sha256: 'a'.repeat(64), altEs: 'Frente' }],
};

const PRODUCT = {
  id: 1,
  sku: 'PACK-30',
  slug: 'mochila-30',
  nameEs: 'Mochila',
  nameEn: 'Backpack',
  descriptionEs: '',
  descriptionEn: '',
  priceMxnCents: 185000,
  stock: 4,
  reservedStock: 0,
  discipline: 'montana',
  brandId: null,
  shippingClass: 'estandar',
  weightGrams: 900,
  lengthMm: 500,
  widthMm: 300,
  heightMm: 200,
  allowsReturn: false,
  isActive: true,
  isTest: false,
  facetValueIds: [],
  gallery: [],
};

describe('product contract of the backoffice, the return flag (FC 073 T0.1)', () => {
  it('accepts returns by default on create, and keeps the flag when given', () => {
    expect(productCreate.parse(BASE).allowsReturn).toBe(true);
    expect(
      productCreate.parse({ ...BASE, allowsReturn: false }).allowsReturn
    ).toBe(false);
  });

  it('refuses a flag that is not a boolean', () => {
    expect(
      productCreate.safeParse({ ...BASE, allowsReturn: 'no' }).success
    ).toBe(false);
  });

  it('lets a patch leave the flag out, or change it', () => {
    expect(productPatch.parse({})).toEqual({});
    expect(productPatch.parse({ allowsReturn: false })).toEqual({
      allowsReturn: false,
    });
  });

  it('answers the flag in the product as the backoffice reads it', () => {
    expect(adminProductSchema.parse(PRODUCT).allowsReturn).toBe(false);
    const without: Partial<typeof PRODUCT> = { ...PRODUCT };
    delete without.allowsReturn;
    expect(adminProductSchema.safeParse(without).success).toBe(false);
  });
});
