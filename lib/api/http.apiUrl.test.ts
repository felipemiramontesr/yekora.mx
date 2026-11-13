import { afterEach, describe, expect, it, vi } from 'vitest';

/** The address of the API is fixed at build time: each case loads the module afresh. */
const load = async (value: string | undefined) => {
  vi.resetModules();
  if (value === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('NEXT_PUBLIC_API_URL', value);
  return (await import('./http')).API_URL;
};

afterEach(() => vi.unstubAllEnvs());

describe('API address (local development override)', () => {
  it('is production when nothing is set', async () => {
    expect(await load(undefined)).toBe('https://apiv1.yekora.mx');
  });

  it('follows a localhost address, for development only', async () => {
    expect(await load('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it('ignores any other address, so a build cannot be pointed elsewhere', async () => {
    expect(await load('https://evil.example')).toBe('https://apiv1.yekora.mx');
    expect(await load('http://localhost.evil.example')).toBe(
      'https://apiv1.yekora.mx'
    );
  });
});
