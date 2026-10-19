/**
 * API configuration from the environment (FC 008), validated once at startup.
 *
 * Production fails closed (ADR 0006, R4): missing database settings stop the process before it
 * listens, instead of running half-configured. Secrets are read here and never logged.
 *
 * @module
 */
import { z } from 'zod';

/** Origins allowed by CORS: the public site and the two local servers (dev and E2E). */
export const CORS_ORIGINS = [
  'https://yekora.mx',
  'http://localhost:3000',
  'http://localhost:3100',
];

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().nonnegative().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  // Same rule as scripts/lib/migrations.ts::isYekoraDatabase: `yekora_…` locally, Hostinger's
  // `u<digits>_yekora[_…]` in production; never another project's database.
  DB_NAME: z
    .string()
    .regex(
      /^(?:u\d+_yekora(?:_[a-z0-9_]+)?|yekora_[a-z0-9_]+)$/,
      'must be a Yekora database'
    ),
  BANXICO_TOKEN: z.string().optional(),
  API_VERSION: z.string().default('0.4.3'),
  GIT_SHA: z.string().default('dev'),
});

/** Database connection settings. */
export interface DbConfig {
  /** MariaDB host. */
  host: string;
  /** MariaDB port. */
  port: number;
  /** Database user. */
  user: string;
  /** Database password (empty only for local XAMPP root). */
  password: string;
  /** Database name; always Yekora's (`yekora_…` or Hostinger's `u<id>_yekora…`). */
  database: string;
}

/** Everything the API needs to start. */
export interface ApiConfig {
  /** Whether this is the production deployment. */
  isProduction: boolean;
  /** Port to listen on (Hostinger sets PORT). */
  port: number;
  /** Interface to bind. */
  host: string;
  /** Database settings. */
  db: DbConfig;
  /** Banxico SIE token; without it the API serves the last stored FIX only. */
  banxicoToken: string | undefined;
  /** Released version, reported by /health. */
  version: string;
  /** Deployed commit, reported by /health and checked by the deploy smoke test. */
  sha: string;
}

/**
 * Parses and validates the environment.
 *
 * @param env - Usually `process.env`.
 * @returns The validated configuration.
 * @throws When a required setting is missing, or production has an empty DB password.
 */
export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = schema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  if (isProduction && parsed.DB_PASSWORD === '') {
    throw new Error('DB_PASSWORD is required in production');
  }
  return {
    isProduction,
    port: parsed.PORT,
    host: parsed.HOST,
    db: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
      database: parsed.DB_NAME,
    },
    banxicoToken: parsed.BANXICO_TOKEN || undefined,
    version: parsed.API_VERSION,
    sha: parsed.GIT_SHA,
  };
}
