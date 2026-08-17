import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { hashPassword } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve DATABASE_PATH against the repo root so dev and prod agree. */
function resolveDbPath(): string {
  if (config.databasePath === ':memory:') return ':memory:';
  return isAbsolute(config.databasePath)
    ? config.databasePath
    : resolve(config.repoRoot, config.databasePath);
}

const dbPath = resolveDbPath();
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

/**
 * The schema file lives next to the source in dev (src/) and is copied beside
 * the compiled output in prod (dist/). Fall back to the sibling src/ directory
 * so `tsc` builds work without a copy step.
 */
function loadSchema(): string {
  for (const candidate of [join(here, 'schema.sql'), join(here, '..', 'src', 'schema.sql')]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error('schema.sql not found next to the server build or source');
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  unit_name: 'Department of Surgery',
  theatres: JSON.stringify(['OT 1', 'OT 2', 'Day Care OT']),
  default_start_time: '09:00',
  default_turnover_min: '20',
  session_am_start: '09:00',
  session_pm_start: '13:30',
  default_duration_min: '60',
  workup_template: JSON.stringify([
    'Complete blood count',
    'Renal function / electrolytes',
    'Coagulation profile',
    'Blood grouping & cross-match',
    'ECG',
    'Chest X-ray',
    'Viral markers',
    'Anaesthetic pre-op review',
    'Informed consent',
    'Imaging reviewed',
  ]),
};

/** Apply the schema and backfill anything a fresh database needs. */
export function migrate(): void {
  db.exec(loadSchema());

  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
  );
  const seedSettings = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) insertSetting.run(key, value);
  });
  seedSettings(Object.entries(DEFAULT_SETTINGS));

  ensureInitialUser();
}

/**
 * Create the consultant account on first boot from the INITIAL_USER_* env vars.
 * Existing accounts are never touched — the password is changed from Settings.
 */
function ensureInitialUser(): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (count.n > 0) return;

  db.prepare(
    `INSERT INTO users (email, name, password_hash, calendar_token)
     VALUES (?, ?, ?, ?)`,
  ).run(
    config.initialUser.email.toLowerCase(),
    config.initialUser.name,
    hashPassword(config.initialUser.password),
    randomBytes(24).toString('hex'),
  );

  console.log(
    `\n  Created the consultant account: ${config.initialUser.email}` +
      `\n  Sign in and change the password from Settings.\n`,
  );
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function getSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

export function logActivity(
  entity: string,
  entityId: number,
  action: string,
  detail?: string,
): void {
  db.prepare(
    'INSERT INTO activity_log (entity, entity_id, action, detail) VALUES (?, ?, ?, ?)',
  ).run(entity, entityId, action, detail ?? null);
}
