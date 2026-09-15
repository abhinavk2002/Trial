import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
/** src/ or dist/ -> server/ -> repo root */
const repoRoot = resolve(here, '..', '..');

dotenv.config({ path: resolve(repoRoot, '.env') });

const isProduction = process.env.NODE_ENV === 'production';

function sessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16 && fromEnv !== 'change-me-to-a-long-random-string') {
    return fromEnv;
  }
  if (isProduction) {
    throw new Error(
      'SESSION_SECRET must be set to a long random value in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  console.warn(
    '[config] SESSION_SECRET is unset or still the placeholder — using a random ' +
      'one for this run. Logins will not survive a restart. Set it in .env.',
  );
  return randomBytes(32).toString('hex');
}

export const config = {
  repoRoot,
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  databasePath: process.env.DATABASE_PATH ?? 'data/ot.db',
  sessionSecret: sessionSecret(),
  secureCookies: process.env.SECURE_COOKIES === 'true',
  sessionMaxAgeMs: 1000 * 60 * 60 * 12,
  initialUser: {
    email: process.env.INITIAL_USER_EMAIL ?? 'consultant@example.com',
    password: process.env.INITIAL_USER_PASSWORD ?? 'change-this-password',
    name: process.env.INITIAL_USER_NAME ?? 'Consultant',
  },
  /** Where the built client lives, served in production. */
  clientDist: resolve(repoRoot, 'client', 'dist'),
} as const;
