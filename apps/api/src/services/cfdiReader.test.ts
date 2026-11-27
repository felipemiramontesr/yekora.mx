/**
 * FC 077 F3 evidence: the CFDI is read by namespace URI whatever its prefixes, with or without a
 * byte order mark; a document type or an entity is refused (T0.3, T2.2), and so is anything that
 * is not a well-formed CFDI 4.0.
 */
import { describe, expect, it } from 'vitest';
import { readCfdi } from './cfdiReader';

const UUID = '6F1C2A3B-4D5E-4F60-8A9B-0C1D2E3F4A5B';

const cfdi = (
  { version = '4.0', total = '1160.00', stamp = '' } = {},
  prefix = 'cfdi'
) => `<?xml version="1.0" encoding="UTF-8"?>
<${prefix}:Comprobante xmlns:${prefix}="http://www.sat.gob.mx/cfd/4" Version="${version}" Total="${total}">
  <${prefix}:Emisor Rfc="YEK010101AB1" Nombre="TIENDA &amp; CIA"/>
  <${prefix}:Receptor Rfc="XAXX010101000"/>
  <${prefix}:Complemento>${stamp}</${prefix}:Complemento>
</${prefix}:Comprobante>`;

const tfd = (
  uuid = UUID.toLowerCase(),
  version = '1.1',
  at = '2026-11-27T10:15:00'
) =>
  `<t:TimbreFiscalDigital xmlns:t="http://www.sat.gob.mx/TimbreFiscalDigital" Version="${version}" UUID="${uuid}" FechaTimbrado="${at}"/>`;

const read = (xml: string) => readCfdi(Buffer.from(xml, 'utf8'));

describe('reading a CFDI 4.0', () => {
  it('reads issuer, receiver, total in cents and the stamp, by namespace and not by prefix', () => {
    const expected = {
      issuerRfc: 'YEK010101AB1',
      receiverRfc: 'XAXX010101000',
      totalCents: 116000,
      stamp: { uuid: UUID, stampedAt: '2026-11-27 10:15:00' },
    };
    expect(read(cfdi({ stamp: tfd() }))).toEqual(expected);
    expect(read(cfdi({ stamp: tfd() }, 'x'))).toEqual(expected);
    expect(read(`﻿${cfdi({ stamp: tfd() })}`)).toEqual(expected);
  });

  it('reads a CFDI that uses the default namespace', () => {
    const xml =
      '<Comprobante xmlns="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="10"/>';
    expect(read(xml)).toEqual({
      issuerRfc: '',
      receiverRfc: '',
      totalCents: 1000,
      stamp: null,
    });
  });

  it.each([
    ['no stamp', ''],
    ['a stamp of another version', tfd(UUID, '1.0')],
    ['a folio that is not one', tfd('abc')],
    ['a stamp with no date', tfd(UUID, '1.1', 'ayer')],
  ])('gives no stamp with %s', (_case, stamp) => {
    expect(read(cfdi({ stamp }))?.stamp).toBeNull();
  });

  it.each([
    ['a document type', `<!DOCTYPE x>${cfdi()}`],
    [
      'an entity',
      `<!doctype x [<!entity e SYSTEM "file:///etc/passwd">]>${cfdi()}`,
    ],
    ['a lone entity declaration', `<!ENTITY e "x">${cfdi()}`],
    ['a broken document', '<cfdi:Comprobante'],
    ['another root', '<a Version="4.0" Total="1"/>'],
    ['the namespace of CFDI 3.3', cfdi().replace('/cfd/4"', '/cfd/3"')],
    ['version 3.3', cfdi({ version: '3.3' })],
    ['no total', cfdi({ total: '' })],
    ['a total that is not an amount', cfdi({ total: '1e9' })],
  ])('refuses %s', (_case, xml) => {
    expect(read(xml)).toBeNull();
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(readCfdi(Buffer.from([0x3c, 0xff, 0xfe, 0x3e]))).toBeNull();
  });
});
