/**
 * Browser side of the anti-bot proof of work (FC 028 Enmienda 1, E1; T1.4): finds the number
 * whose SHA-256 with the salt is the challenge, and packs the solution as the API expects it,
 * base64 JSON in the ALTCHA format. Web Crypto only: no third party, no network.
 *
 * @module
 */
import type { BotChallenge } from './authTypes';

// Hashes in flight at once: enough to keep Web Crypto busy without flooding the page.
const BATCH = 500;

/** SHA-256 of a text as lowercase hex, with the browser's Web Crypto. */
async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Solves a challenge by trying every number from 0 to `maxnumber`, in batches.
 *
 * @param challenge - The challenge the API handed out.
 * @returns The solution as base64 JSON, or null when no number matches (a forged challenge).
 */
export async function solveBotChallenge(
  challenge: BotChallenge
): Promise<string | null> {
  for (let start = 0; start <= challenge.maxnumber; start += BATCH) {
    const end = Math.min(start + BATCH, challenge.maxnumber + 1);
    const numbers = Array.from({ length: end - start }, (_, i) => start + i);
    const hashes = await Promise.all(
      numbers.map((number) => sha256Hex(`${challenge.salt}${number}`))
    );
    const found = hashes.indexOf(challenge.challenge);
    if (found !== -1) {
      return btoa(JSON.stringify({ ...challenge, number: numbers[found] }));
    }
  }
  return null;
}
