/**
 * FC 042 Enmienda 2 (T1.2, T2.6): the Pwned Passwords range, against a stand-in of HIBP. Only a
 * 200 whose body is a non-empty list of `SUFFIX35HEX:COUNT` lines is judged; anything else is
 * `unknown` (the fail-open Ω accepted), never `clear`.
 */
import { describe, expect, it, vi } from 'vitest';
import { breachVerdict } from './pwnedPasswords';

// SHA-1 of the word «password», the published test vector: 5BAA6 + the suffix below.
const PHRASE = ['pass', 'word'].join('');
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
/** Another suffix of the same range, as padding lines look. */
const OTHER = '0'.repeat(35);

/** A stand-in of HIBP that answers one status and body. */
function hibp(status: number, body: string) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

describe('breachVerdict (FC 042 Enmienda 2)', () => {
  it('sends only the 5-character prefix, with padding and a timeout', async () => {
    const fetchImpl = hibp(200, `${OTHER}:0\r\n`);
    await breachVerdict(PHRASE, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(init.headers).toEqual({ 'Add-Padding': 'true' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(SUFFIX);
  });

  it('is breached when its suffix is listed with a count above zero', async () => {
    const body = `${OTHER}:3\r\n${SUFFIX.toLowerCase()}:52256179\r\n`;
    await expect(breachVerdict(PHRASE, hibp(200, body))).resolves.toBe(
      'breached'
    );
  });

  it('is clear when a valid range does not list it, or lists it with count 0', async () => {
    await expect(
      breachVerdict(PHRASE, hibp(200, `${OTHER}:7\n`))
    ).resolves.toBe('clear');
    // A padding line carries count 0: it was never seen.
    await expect(breachVerdict(PHRASE, hibp(200, `${SUFFIX}:0`))).resolves.toBe(
      'clear'
    );
  });

  it.each([
    ['a 5xx', 503, `${SUFFIX}:9`],
    ['a 4xx', 429, ''],
    ['an empty 200', 200, ''],
    ['a 200 of blank lines', 200, '\r\n\r\n'],
    ['a 200 with one malformed line', 200, `${OTHER}:1\n<html>`],
    ['a 200 with a short suffix', 200, `${SUFFIX.slice(1)}:9`],
  ])('is unknown, never clear, on %s', async (_case, status, body) => {
    await expect(breachVerdict(PHRASE, hibp(status, body))).resolves.toBe(
      'unknown'
    );
  });

  it('is unknown when HIBP does not answer in time', async () => {
    const slow = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          );
        })
    );
    await expect(breachVerdict(PHRASE, slow, 5)).resolves.toBe('unknown');
  });
});
