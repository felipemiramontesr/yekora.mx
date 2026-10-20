import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_MAGIC,
  createDecryptStream,
  createEncryptStream,
  decryptToFile,
  encryptToFile,
  isGcmBackup,
  verifyBackup,
} from './backupCrypto';

const SECRET =
  'a-64-character-secret-of-the-production-db-environment-0123456789';
const HEADER = 13 + 16 + 12;
const TAG = 16;

/** Runs bytes through a stream, delivered in chunks of `size`, and collects the output. */
async function through(
  stream: NodeJS.ReadWriteStream,
  bytes: Buffer,
  size = 64 * 1024
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const pieces: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += size)
    pieces.push(bytes.subarray(i, i + size));
  await pipeline(
    Readable.from(pieces),
    stream,
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    })
  );
  return Buffer.concat(chunks);
}

const encrypt = (plain: Buffer, secret = SECRET) =>
  through(createEncryptStream(secret), plain);
const decrypt = (sealed: Buffer, secret = SECRET, size?: number) =>
  through(createDecryptStream(secret), sealed, size);

describe('YEKORA_GCM_V1 format', () => {
  it('starts with the magic, a fresh salt and IV, and ends with a 16-byte tag', async () => {
    const plain = Buffer.from('dump');
    const first = await encrypt(plain);
    const second = await encrypt(plain);
    expect(first.subarray(0, 13).toString('ascii')).toBe('YEKORA_GCM_V1');
    expect(first).toHaveLength(HEADER + plain.length + TAG);
    // Same secret and same text, yet another salt and IV: another key and another file.
    expect(first.subarray(13, HEADER).equals(second.subarray(13, HEADER))).toBe(
      false
    );
    expect(first.equals(second)).toBe(false);
  });

  it('tells authenticated backups from legacy openssl ones', () => {
    expect(isGcmBackup(Buffer.concat([BACKUP_MAGIC, randomBytes(28)]))).toBe(
      true
    );
    expect(isGcmBackup(Buffer.from('Salted__12345678'))).toBe(false);
    expect(isGcmBackup(Buffer.from('YEKORA'))).toBe(false);
  });
});

describe('T1.3 · DecryptionAllowed ⟺ K ∧ T', () => {
  it('K ⊤ T ⊤: decrypts exactly what was encrypted, whatever the chunk size', async () => {
    const plain = randomBytes(200_000);
    const sealed = await encrypt(plain);
    expect((await decrypt(sealed)).equals(plain)).toBe(true);
    // One byte at a time crosses every boundary: header, held-back tag, body.
    const small = randomBytes(100);
    expect((await decrypt(await encrypt(small), SECRET, 1)).equals(small)).toBe(
      true
    );
  });

  it('K ⊤ T ⊤: an empty plaintext round-trips too', async () => {
    const sealed = await encrypt(Buffer.alloc(0));
    expect(sealed).toHaveLength(HEADER + TAG);
    expect(await decrypt(sealed)).toHaveLength(0);
  });

  it('K ⊤ T ⊥: one flipped bit anywhere fails authentication', async () => {
    const sealed = await encrypt(randomBytes(1000));
    for (const offset of [HEADER + 10, sealed.length - 1, 20]) {
      const altered = Buffer.from(sealed);
      altered[offset] ^= 0x01;
      await expect(decrypt(altered)).rejects.toThrow(/failed authentication/);
    }
  });

  it('K ⊥ T ⊤: the wrong key fails authentication', async () => {
    const sealed = await encrypt(randomBytes(1000));
    await expect(decrypt(sealed, 'another-secret')).rejects.toThrow(
      /failed authentication/
    );
  });

  it('K ⊥: an empty key is refused before anything is encrypted or decrypted', async () => {
    expect(() => createEncryptStream('')).toThrow('backup key is empty');
    const sealed = await encrypt(randomBytes(10));
    await expect(decrypt(sealed, '')).rejects.toThrow('backup key is empty');
  });

  it('rejects a legacy or foreign file and a truncated one', async () => {
    await expect(
      decrypt(Buffer.from('Salted__' + 'x'.repeat(60)))
    ).rejects.toThrow('not a YEKORA_GCM_V1 backup');
    await expect(decrypt(Buffer.from('YEKORA_GCM'))).rejects.toThrow(
      'backup is truncated'
    );
    const sealed = await encrypt(randomBytes(1000));
    await expect(decrypt(sealed.subarray(0, HEADER + 5))).rejects.toThrow(
      'backup is truncated'
    );
  });
});

describe('files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yekora-crypto-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const dump = gzipSync(
    'CREATE TABLE products (id INT);\n-- Dump completed on 2026-10-19\n'
  );

  it('encrypts to a file, verifies it and decrypts it back', async () => {
    const sealed = join(dir, 'backup.sql.gz.enc');
    const opened = join(dir, 'backup.sql.gz');
    await encryptToFile(Readable.from([dump]), sealed, SECRET);
    expect(isGcmBackup(readFileSync(sealed))).toBe(true);
    await expect(verifyBackup(sealed, SECRET)).resolves.toBeUndefined();
    await decryptToFile(sealed, opened, SECRET);
    expect(readFileSync(opened).equals(dump)).toBe(true);
  });

  it('deletes the partial output when the file does not authenticate', async () => {
    const sealed = join(dir, 'backup.sql.gz.enc');
    const opened = join(dir, 'backup.sql.gz');
    await encryptToFile(Readable.from([randomBytes(5000)]), sealed, SECRET);
    await expect(decryptToFile(sealed, opened, 'wrong')).rejects.toThrow(
      /failed authentication/
    );
    expect(existsSync(opened)).toBe(false);
  });

  it('refuses a backup that authenticates but is not a complete dump', async () => {
    const sealed = join(dir, 'cut.sql.gz.enc');
    await encryptToFile(
      Readable.from([gzipSync('CREATE TABLE')]),
      sealed,
      SECRET
    );
    await expect(verifyBackup(sealed, SECRET)).rejects.toThrow(
      'backup does not end with a complete dump'
    );
  });

  it('refuses to verify an altered backup', async () => {
    const sealed = join(dir, 'backup.sql.gz.enc');
    await encryptToFile(Readable.from([dump]), sealed, SECRET);
    const altered = readFileSync(sealed);
    altered[altered.length - 1] ^= 0x80;
    writeFileSync(sealed, altered);
    await expect(verifyBackup(sealed, SECRET)).rejects.toThrow();
  });
});
