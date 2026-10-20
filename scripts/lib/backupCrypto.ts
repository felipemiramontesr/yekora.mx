/**
 * Authenticated encryption of database backups (FC 010 · YekoraALE · OWASP A02, truth table
 * T1.3: DecryptionAllowed ⟺ K ∧ T).
 *
 * File format `YEKORA_GCM_V1`:
 *
 *   magic `YEKORA_GCM_V1` (13 B) · scrypt salt (16 B) · IV (12 B) · ciphertext · GCM tag (16 B)
 *
 * The tag goes last so a dump of any size is encrypted and decrypted as a stream, never held
 * in memory. The key is `scrypt(secret, salt, 32)` with N 16384, r 8, p 1: the secret stays
 * the same `DB_BACKUP_ENCRYPTION_KEY` the openssl CBC backups used, and each file gets its own
 * salt and therefore its own key.
 *
 * A streamed GCM decryption emits plaintext before the tag at the end can be checked, so
 * nothing here hands plaintext to a consumer that acts on it: {@link decryptToFile} writes to a
 * file and deletes it unless the tag verifies, and the restore loads only from that file.
 * Earlier backups (`Salted__`, openssl `aes-256-cbc -pbkdf2`) stay readable through openssl;
 * {@link isGcmBackup} tells the two apart.
 *
 * @module
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  type DecipherGCM,
} from 'node:crypto';
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { Transform, Writable, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

/** First bytes of every authenticated backup. */
export const BACKUP_MAGIC = Buffer.from('YEKORA_GCM_V1', 'ascii');

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = BACKUP_MAGIC.length + SALT_BYTES + IV_BYTES;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
// mysqldump writes this line last; a dump without it was cut short.
const DUMP_COMPLETED = '-- Dump completed';

/** 256-bit key of one file, from the shared secret and that file's salt. */
function deriveKey(secret: string, salt: Buffer): Buffer {
  if (secret.length === 0) throw new Error('backup key is empty');
  return scryptSync(secret, salt, 32, SCRYPT_PARAMS);
}

/**
 * Whether a file starts with the `YEKORA_GCM_V1` magic, i.e. is an authenticated backup and not
 * a legacy openssl one.
 *
 * @param head - First bytes of the file (at least 13 to match).
 */
export function isGcmBackup(head: Buffer): boolean {
  return head.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC);
}

/**
 * Stream that turns plaintext into a `YEKORA_GCM_V1` file: header first, tag last.
 *
 * @param secret - Backup secret; fails when empty.
 */
export function createEncryptStream(secret: string): Transform {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv, {
    authTagLength: TAG_BYTES,
  });
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      done(null, cipher.update(chunk));
    },
    flush(done) {
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
  stream.push(Buffer.concat([BACKUP_MAGIC, salt, iv]));
  return stream;
}

/** Decipher for a file whose 41-byte header (magic, salt, IV) is `head`. */
function openHeader(head: Buffer, secret: string): DecipherGCM {
  if (!isGcmBackup(head)) throw new Error('not a YEKORA_GCM_V1 backup');
  const salt = head.subarray(
    BACKUP_MAGIC.length,
    BACKUP_MAGIC.length + SALT_BYTES
  );
  const iv = head.subarray(BACKUP_MAGIC.length + SALT_BYTES, HEADER_BYTES);
  return createDecipheriv('aes-256-gcm', deriveKey(secret, salt), iv, {
    authTagLength: TAG_BYTES,
  });
}

/**
 * Stream that decrypts a `YEKORA_GCM_V1` file. It ends with an error, after emitting the
 * plaintext, when the key is wrong or a single bit changed (T1.3 rows ⊤⊥, ⊥⊤, ⊥⊥), so its
 * output may only be trusted once the stream finished cleanly.
 *
 * @param secret - Backup secret; fails when empty.
 */
export function createDecryptStream(secret: string): Transform {
  let pending = Buffer.alloc(0);
  let decipher: DecipherGCM | undefined;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      pending = Buffer.concat([pending, chunk]);
      if (decipher === undefined) {
        if (pending.length < HEADER_BYTES) return done();
        try {
          decipher = openHeader(pending, secret);
        } catch (error: unknown) {
          return done(error as Error);
        }
        pending = pending.subarray(HEADER_BYTES);
      }
      // The last 16 bytes seen so far may be the tag: they are held back until the end.
      const ready = pending.length - TAG_BYTES;
      if (ready <= 0) return done();
      const plain = decipher.update(pending.subarray(0, ready));
      pending = pending.subarray(ready);
      done(null, plain);
    },
    flush(done) {
      if (decipher === undefined || pending.length !== TAG_BYTES) {
        return done(new Error('backup is truncated'));
      }
      decipher.setAuthTag(pending);
      try {
        done(null, decipher.final());
      } catch {
        done(
          new Error('backup failed authentication: wrong key or altered file')
        );
      }
    },
  });
}

/**
 * Encrypts a stream (the gzipped dump) into `outFile`.
 *
 * @param input - Plaintext source.
 * @param outFile - Destination file, created or replaced.
 * @param secret - Backup secret.
 */
export async function encryptToFile(
  input: Readable,
  outFile: string,
  secret: string
): Promise<void> {
  await pipeline(
    input,
    createEncryptStream(secret),
    createWriteStream(outFile)
  );
}

/**
 * Decrypts `inFile` into `outFile` and keeps it only when the tag verifies; on any failure the
 * partial output is deleted and the error is rethrown. Nothing reads `outFile` before this
 * resolves, so no unauthenticated byte ever reaches the database.
 *
 * @param inFile - `YEKORA_GCM_V1` file.
 * @param outFile - Destination of the plaintext (the gzipped dump).
 * @param secret - Backup secret.
 */
export async function decryptToFile(
  inFile: string,
  outFile: string,
  secret: string
): Promise<void> {
  try {
    await pipeline(
      createReadStream(inFile),
      createDecryptStream(secret),
      createWriteStream(outFile)
    );
  } catch (error: unknown) {
    rmSync(outFile, { force: true });
    throw error;
  }
}

/**
 * Verifies a backup end to end without writing it anywhere: it must authenticate, gunzip and end
 * with mysqldump's completion line. The production workflow runs this before any migration.
 *
 * @param inFile - `YEKORA_GCM_V1` file.
 * @param secret - Backup secret.
 */
export async function verifyBackup(
  inFile: string,
  secret: string
): Promise<void> {
  let tail = '';
  await pipeline(
    createReadStream(inFile),
    createDecryptStream(secret),
    createGunzip(),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        tail = (tail + chunk.toString('utf8')).slice(-300);
        done();
      },
    })
  );
  if (!tail.includes(DUMP_COMPLETED)) {
    throw new Error('backup does not end with a complete dump');
  }
}
