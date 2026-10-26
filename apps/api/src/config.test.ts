import { describe, expect, it } from 'vitest';
import { CORS_ORIGINS, loadConfig } from './config';

const base = { DB_HOST: '127.0.0.1', DB_USER: 'root', DB_NAME: 'yekora_dev' };

describe('loadConfig', () => {
  it('fills safe defaults for local development', () => {
    expect(loadConfig(base)).toEqual({
      isProduction: false,
      port: 3001,
      host: '0.0.0.0',
      db: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: 'yekora_dev',
      },
      banxicoToken: undefined,
      version: '0.7.4',
      sha: 'dev',
    });
  });

  it('reads the production settings, including the deployed SHA and the Banxico token', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      PORT: '8080',
      DB_PASSWORD: 's3cret',
      BANXICO_TOKEN: 'token',
      GIT_SHA: 'abc123',
    });
    expect(config).toMatchObject({
      isProduction: true,
      port: 8080,
      banxicoToken: 'token',
      sha: 'abc123',
    });
    expect(config.db.password).toBe('s3cret');
  });

  it('fails closed in production without a database password', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'DB_PASSWORD is required in production'
    );
  });

  it('accepts the Hostinger database of the account (u<id>_yekora)', () => {
    expect(
      loadConfig({ ...base, DB_NAME: 'u123456789_yekora' }).db.database
    ).toBe('u123456789_yekora');
  });

  it.each([
    ['a non-Yekora database', { ...base, DB_NAME: 'archon' }],
    [
      'another project on the same Hostinger account',
      { ...base, DB_NAME: 'u123456789_archon' },
    ],
    ['a missing host', { DB_USER: 'root', DB_NAME: 'yekora_dev' }],
  ])('refuses %s', (_case, env) => {
    expect(() => loadConfig(env)).toThrow();
  });

  it('treats an empty Banxico token as no token', () => {
    expect(
      loadConfig({ ...base, BANXICO_TOKEN: '' }).banxicoToken
    ).toBeUndefined();
  });

  it('allows only the public site and the local servers as CORS origins', () => {
    expect(CORS_ORIGINS).toEqual([
      'https://yekora.mx',
      'http://localhost:3000',
      'http://localhost:3100',
    ]);
  });
});
