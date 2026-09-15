-- OT Manager schema. Applied on every boot; every statement is idempotent.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Account (single consultant, but modelled as a table so more can be added)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  calendar_token  TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Key/value settings (theatres, session times, default durations, unit name)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mrn            TEXT,                       -- hospital / UHID number
  name           TEXT NOT NULL,
  sex            TEXT NOT NULL DEFAULT 'unknown',   -- male | female | other | unknown
  date_of_birth  TEXT,                       -- YYYY-MM-DD
  age_years      INTEGER,                    -- fallback when DOB unknown
  phone          TEXT,
  alt_phone      TEXT,
  address        TEXT,
  blood_group    TEXT,
  allergies      TEXT,
  comorbidities  TEXT,                       -- free text: DM, HTN, CAD ...
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_mrn  ON patients(mrn);

-- ---------------------------------------------------------------------------
-- Surgical cases. One patient can have several over time.
-- ---------------------------------------------------------------------------
-- status flow:
--   workup       -> being investigated / optimised, not datable yet
--   ready        -> workup complete, waiting for a date
--   offered      -> a date has been offered, waiting for the patient to confirm
--   confirmed    -> patient accepted the date; eligible for the OT list
--   listed       -> placed on a generated OT list for that date
--   done         -> operated
--   postponed    -> was dated, slipped; back in the pool
--   cancelled    -> not proceeding
CREATE TABLE IF NOT EXISTS cases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  diagnosis         TEXT NOT NULL,
  procedure         TEXT NOT NULL,
  laterality        TEXT NOT NULL DEFAULT 'na',        -- left | right | bilateral | na
  anaesthesia       TEXT NOT NULL DEFAULT 'ga',        -- ga | sa | la | ra | sedation
  priority          TEXT NOT NULL DEFAULT 'routine',   -- emergency | urgent | routine
  status            TEXT NOT NULL DEFAULT 'workup',
  duration_min      INTEGER NOT NULL DEFAULT 60,
  is_daycare        INTEGER NOT NULL DEFAULT 0,
  is_infected       INTEGER NOT NULL DEFAULT 0,        -- contaminated / septic: goes last
  needs_icu         INTEGER NOT NULL DEFAULT 0,
  needs_frozen      INTEGER NOT NULL DEFAULT 0,
  blood_units       INTEGER NOT NULL DEFAULT 0,
  implants          TEXT,                              -- implants / special instruments
  equipment         TEXT,                              -- C-arm, laparoscopy stack, microscope
  special_notes     TEXT,
  consent_signed    INTEGER NOT NULL DEFAULT 0,
  anaesthetic_clear INTEGER NOT NULL DEFAULT 0,
  scheduled_date    TEXT,                              -- YYYY-MM-DD once dated
  target_month      TEXT,                              -- YYYY-MM soft target while waiting
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cases_patient   ON cases(patient_id);
CREATE INDEX IF NOT EXISTS idx_cases_status    ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_scheduled ON cases(scheduled_date);

-- ---------------------------------------------------------------------------
-- Pre-op workup checklist, per case
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workup_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  due_date   TEXT,
  notes      TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workup_case ON workup_items(case_id);

-- ---------------------------------------------------------------------------
-- Availability calls: "we rang the patient and offered them a date"
-- ---------------------------------------------------------------------------
-- outcome: accepted | declined | no_answer | callback | deferred
CREATE TABLE IF NOT EXISTS call_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  called_at    TEXT NOT NULL DEFAULT (datetime('now')),
  offered_date TEXT,
  outcome      TEXT NOT NULL,
  notes        TEXT,
  next_call_on TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calls_case ON call_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_calls_next ON call_logs(next_call_on);

-- ---------------------------------------------------------------------------
-- OT lists: one per (date, theatre). Generated from confirmed cases, then
-- freely editable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ot_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  list_date     TEXT NOT NULL,                    -- YYYY-MM-DD
  theatre       TEXT NOT NULL DEFAULT 'OT 1',
  session       TEXT NOT NULL DEFAULT 'full',     -- am | pm | full
  start_time    TEXT NOT NULL DEFAULT '09:00',    -- HH:MM
  turnover_min  INTEGER NOT NULL DEFAULT 20,
  surgeon       TEXT,
  anaesthetist  TEXT,
  scrub_nurse   TEXT,
  notes         TEXT,
  locked        INTEGER NOT NULL DEFAULT 0,       -- finalised; blocks auto-regeneration
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list_date, theatre)
);

CREATE INDEX IF NOT EXISTS idx_lists_date ON ot_lists(list_date);

-- ---------------------------------------------------------------------------
-- Entries on an OT list. position drives running order; duration_min is
-- copied from the case at generation time so it can be tweaked per list.
-- ---------------------------------------------------------------------------
-- status: planned | in_progress | done | cancelled
CREATE TABLE IF NOT EXISTS ot_list_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id      INTEGER NOT NULL REFERENCES ot_lists(id) ON DELETE CASCADE,
  case_id      INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  duration_min INTEGER NOT NULL DEFAULT 60,
  status       TEXT NOT NULL DEFAULT 'planned',
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_list ON ot_list_entries(list_id);
CREATE INDEX IF NOT EXISTS idx_entries_case ON ot_list_entries(case_id);

-- ---------------------------------------------------------------------------
-- Audit trail, so "scope for changes" is traceable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,     -- patient | case | ot_list | call
  entity_id   INTEGER NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_time   ON activity_log(created_at);
