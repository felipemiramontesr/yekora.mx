/**
 * Password hashing (FC 028 T2.1b, 277_AN V1): Argon2id through hash-wasm, WebAssembly embedded
 * in the JavaScript, so it travels inside the single dist/index.js Hostinger runs. A native
 * module would need a compiled binary Hostinger never installs.
 *
 * Parameters are OWASP's first Argon2id profile (19 MiB, 2 passes, 1 lane). Every hash carries
 * its own random salt and its parameters (`$argon2id$v=19$m=19456,t=2,p=1$…`), so raising them
 * later keeps old hashes verifiable.
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/** OWASP Argon2id profile: 19 MiB of memory, 2 iterations, 1 lane. */
const PARAMETERS = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

/**
 * Hashes a password for storage.
 *
 * @param password - The password as typed.
 * @returns The encoded `$argon2id$…` string, salt and parameters included.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2id({
    ...PARAMETERS,
    password,
    salt: randomBytes(16),
    outputType: 'encoded',
  });
}

/**
 * Checks a password against a stored hash.
 *
 * @param hash - The stored `$argon2id$…` string.
 * @param password - The password as typed.
 * @returns True when it matches; false for a wrong password or a malformed hash.
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2Verify({ hash, password });
  } catch {
    return false;
  }
}

/**
 * The hash a privileged account is born with (FC 044 T2.2): Argon2id of 64 random bytes thrown
 * away here, so no password matches it and none is ever shown, mailed or stored. The holder
 * sets the real one through a 15-minute reset link.
 *
 * @returns An `$argon2id$…` string that satisfies `ck_users_hash` and opens nothing.
 */
export function unmatchableHash(): Promise<string> {
  return hashPassword(randomBytes(64).toString('hex'));
}

let decoy: Promise<string> | undefined;

/**
 * A real hash of a random password nobody knows, made once per process. It is verified when the
 * e-mail is unknown, so a missing account and a wrong password cost the same Argon2id work (no
 * account enumeration by timing).
 *
 * @returns The decoy hash.
 */
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(32).toString('base64url'));
  return decoy;
}
