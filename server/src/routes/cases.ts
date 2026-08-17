import { Router } from 'express';
import { z } from 'zod';
import { db, getSetting, logActivity } from '../db.js';
import { getCase, listCases } from '../lib/queries.js';
import {
  boolish,
  dateString,
  handler,
  HttpError,
  idParam,
  monthString,
  notFound,
  optionalText,
  parseBody,
} from '../lib/http.js';
import type { CallLog, CaseStatus, WorkupItem } from '../types.js';
import { CASE_STATUSES } from '../types.js';

export const casesRouter = Router();

const caseSchema = z.object({
  patient_id: z.number().int().positive(),
  diagnosis: z.string().trim().min(1, 'Diagnosis is required'),
  procedure: z.string().trim().min(1, 'Planned procedure is required'),
  laterality: z.enum(['left', 'right', 'bilateral', 'na']).default('na'),
  anaesthesia: z.enum(['ga', 'sa', 'la', 'ra', 'sedation']).default('ga'),
  priority: z.enum(['emergency', 'urgent', 'routine']).default('routine'),
  status: z.enum(CASE_STATUSES as [CaseStatus, ...CaseStatus[]]).default('workup'),
  duration_min: z.number().int().min(5).max(1440).default(60),
  is_daycare: boolish.default(0),
  is_infected: boolish.default(0),
  needs_icu: boolish.default(0),
  needs_frozen: boolish.default(0),
  blood_units: z.number().int().min(0).max(50).default(0),
  implants: optionalText,
  equipment: optionalText,
  special_notes: optionalText,
  consent_signed: boolish.default(0),
  anaesthetic_clear: boolish.default(0),
  scheduled_date: dateString.nullable().optional(),
  target_month: monthString.nullable().optional(),
});

const patchSchema = caseSchema.partial().omit({ patient_id: true });

const FIELDS = [
  'diagnosis',
  'procedure',
  'laterality',
  'anaesthesia',
  'priority',
  'status',
  'duration_min',
  'is_daycare',
  'is_infected',
  'needs_icu',
  'needs_frozen',
  'blood_units',
  'implants',
  'equipment',
  'special_notes',
  'consent_signed',
  'anaesthetic_clear',
  'scheduled_date',
  'target_month',
] as const;

function workupTemplate(): string[] {
  try {
    const parsed = JSON.parse(getSetting('workup_template') ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function insertWorkupItems(caseId: number, labels: string[]): void {
  const stmt = db.prepare(
    'INSERT INTO workup_items (case_id, label, position) VALUES (?, ?, ?)',
  );
  const startRow = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM workup_items WHERE case_id = ?')
    .get(caseId) as { max: number };

  const insertAll = db.transaction((items: string[]) => {
    items.forEach((label, i) => stmt.run(caseId, label, startRow.max + 1 + i));
  });
  insertAll(labels);
}

function getWorkup(caseId: number): WorkupItem[] {
  return db
    .prepare('SELECT * FROM workup_items WHERE case_id = ? ORDER BY position, id')
    .all(caseId) as WorkupItem[];
}

function getCalls(caseId: number): CallLog[] {
  return db
    .prepare('SELECT * FROM call_logs WHERE case_id = ? ORDER BY called_at DESC, id DESC')
    .all(caseId) as CallLog[];
}

function requireCase(id: number) {
  const found = getCase(id);
  if (!found) throw notFound('Case');
  return found;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

casesRouter.get(
  '/',
  handler((req, res) => {
    const q = req.query;
    const statusParam = typeof q.status === 'string' ? q.status : undefined;
    res.json(
      listCases({
        status: statusParam ? statusParam.split(',').filter(Boolean) : undefined,
        patientId: q.patient_id ? Number(q.patient_id) : undefined,
        date: typeof q.date === 'string' ? q.date : undefined,
        from: typeof q.from === 'string' ? q.from : undefined,
        to: typeof q.to === 'string' ? q.to : undefined,
        search: typeof q.search === 'string' && q.search.trim() ? q.search.trim() : undefined,
        undated: q.undated === 'true',
      }),
    );
  }),
);

casesRouter.get(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const found = requireCase(id);
    const listing = db
      .prepare(
        `SELECT l.id AS list_id, l.list_date, l.theatre, e.position
           FROM ot_list_entries e
           JOIN ot_lists l ON l.id = e.list_id
          WHERE e.case_id = ?`,
      )
      .all(id);

    res.json({ ...found, workup: getWorkup(id), calls: getCalls(id), listings: listing });
  }),
);

casesRouter.post(
  '/',
  handler((req, res) => {
    const body = parseBody(
      caseSchema.extend({ apply_workup_template: z.boolean().default(true) }),
      req.body,
    );

    const patientExists = db
      .prepare('SELECT 1 FROM patients WHERE id = ?')
      .get(body.patient_id);
    if (!patientExists) throw new HttpError(400, 'No such patient');

    const info = db
      .prepare(
        `INSERT INTO cases (patient_id, ${FIELDS.join(', ')})
         VALUES (?, ${FIELDS.map(() => '?').join(', ')})`,
      )
      .run(body.patient_id, ...FIELDS.map((f) => body[f] ?? null));

    const id = Number(info.lastInsertRowid);
    if (body.apply_workup_template) insertWorkupItems(id, workupTemplate());
    logActivity('case', id, 'created', `${body.procedure} for patient ${body.patient_id}`);

    res.status(201).json(getCase(id));
  }),
);

casesRouter.patch(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);

    const body = parseBody(patchSchema, req.body);
    const changed = FIELDS.filter((f) => f in body);
    if (changed.length > 0) {
      db.prepare(
        `UPDATE cases SET ${changed.map((f) => `${f} = ?`).join(', ')},
                updated_at = datetime('now')
          WHERE id = ?`,
      ).run(...changed.map((f) => body[f] ?? null), id);
      logActivity('case', id, 'updated', changed.join(', '));
    }

    res.json(getCase(id));
  }),
);

casesRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);
    db.prepare('DELETE FROM cases WHERE id = ?').run(id);
    logActivity('case', id, 'deleted');
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Dating a case
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  scheduled_date: dateString,
  /** false = offered and awaiting the patient's answer; true = they accepted. */
  confirmed: z.boolean().default(false),
  notes: optionalText,
});

casesRouter.post(
  '/:id/schedule',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);
    const { scheduled_date, confirmed, notes } = parseBody(scheduleSchema, req.body);

    db.prepare(
      `UPDATE cases SET scheduled_date = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(scheduled_date, confirmed ? 'confirmed' : 'offered', id);

    logActivity(
      'case',
      id,
      confirmed ? 'date confirmed' : 'date offered',
      `${scheduled_date}${notes ? ` — ${notes}` : ''}`,
    );
    res.json(getCase(id));
  }),
);

const unscheduleSchema = z.object({
  /** postponed keeps the history visible; cancelled takes it out of the pool. */
  reason: z.enum(['postponed', 'cancelled', 'back_to_pool']).default('back_to_pool'),
  notes: optionalText,
});

casesRouter.post(
  '/:id/unschedule',
  handler((req, res) => {
    const id = idParam(req);
    const existing = requireCase(id);
    const { reason, notes } = parseBody(unscheduleSchema, req.body);

    // Coming off a date sends the case back to the right pool bucket: still
    // being worked up, or ready and waiting for another date.
    const nextStatus: CaseStatus =
      reason === 'cancelled'
        ? 'cancelled'
        : reason === 'postponed'
          ? 'postponed'
          : existing.workup_total > 0 && existing.workup_done < existing.workup_total
            ? 'workup'
            : 'ready';

    const removeFromLists = db.transaction(() => {
      db.prepare('DELETE FROM ot_list_entries WHERE case_id = ?').run(id);
      db.prepare(
        `UPDATE cases SET scheduled_date = NULL, status = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(nextStatus, id);
    });
    removeFromLists();

    logActivity('case', id, `removed from ${existing.scheduled_date ?? 'schedule'}`, notes ?? reason);
    res.json(getCase(id));
  }),
);

// ---------------------------------------------------------------------------
// Workup checklist
// ---------------------------------------------------------------------------

casesRouter.get(
  '/:id/workup',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);
    res.json(getWorkup(id));
  }),
);

const workupCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label is required'),
  due_date: dateString.nullable().optional(),
  notes: optionalText,
});

casesRouter.post(
  '/:id/workup',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);
    const body = parseBody(workupCreateSchema, req.body);

    const next = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM workup_items WHERE case_id = ?')
      .get(id) as { pos: number };

    db.prepare(
      'INSERT INTO workup_items (case_id, label, due_date, notes, position) VALUES (?, ?, ?, ?, ?)',
    ).run(id, body.label, body.due_date ?? null, body.notes ?? null, next.pos);

    res.status(201).json(getWorkup(id));
  }),
);

casesRouter.post(
  '/:id/workup/apply-template',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);

    // Only add what is missing, so re-applying never duplicates a row.
    const existing = new Set(getWorkup(id).map((w) => w.label.toLowerCase()));
    const missing = workupTemplate().filter((l) => !existing.has(l.toLowerCase()));
    insertWorkupItems(id, missing);

    res.json(getWorkup(id));
  }),
);

const workupPatchSchema = z.object({
  label: z.string().trim().min(1).optional(),
  done: boolish.optional(),
  due_date: dateString.nullable().optional(),
  notes: optionalText,
});

export const workupRouter = Router();

workupRouter.patch(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const item = db.prepare('SELECT * FROM workup_items WHERE id = ?').get(id) as
      | WorkupItem
      | undefined;
    if (!item) throw notFound('Workup item');

    const body = parseBody(workupPatchSchema, req.body);
    db.prepare(
      `UPDATE workup_items
          SET label = ?, done = ?, due_date = ?, notes = ?,
              done_at = CASE WHEN ? = 1 AND done = 0 THEN datetime('now')
                             WHEN ? = 0 THEN NULL
                             ELSE done_at END
        WHERE id = ?`,
    ).run(
      body.label ?? item.label,
      body.done ?? item.done,
      body.due_date === undefined ? item.due_date : body.due_date,
      body.notes === undefined ? item.notes : body.notes,
      body.done ?? item.done,
      body.done ?? item.done,
      id,
    );

    res.json(getWorkup(item.case_id));
  }),
);

workupRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const item = db.prepare('SELECT * FROM workup_items WHERE id = ?').get(id) as
      | WorkupItem
      | undefined;
    if (!item) throw notFound('Workup item');
    db.prepare('DELETE FROM workup_items WHERE id = ?').run(id);
    res.json(getWorkup(item.case_id));
  }),
);

// ---------------------------------------------------------------------------
// Availability calls
// ---------------------------------------------------------------------------

const callSchema = z.object({
  outcome: z.enum(['accepted', 'declined', 'no_answer', 'callback', 'deferred']),
  offered_date: dateString.nullable().optional(),
  notes: optionalText,
  next_call_on: dateString.nullable().optional(),
  called_at: z.string().trim().min(1).optional(),
});

casesRouter.get(
  '/:id/calls',
  handler((req, res) => {
    const id = idParam(req);
    requireCase(id);
    res.json(getCalls(id));
  }),
);

/**
 * Logging a call also moves the case, because that is what the phone call
 * actually decided: an accepted date confirms the case, a declined one puts
 * the patient back in the pool.
 */
casesRouter.post(
  '/:id/calls',
  handler((req, res) => {
    const id = idParam(req);
    const existing = requireCase(id);
    const body = parseBody(callSchema, req.body);

    const record = db.transaction(() => {
      db.prepare(
        `INSERT INTO call_logs (case_id, called_at, offered_date, outcome, notes, next_call_on)
         VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`,
      ).run(
        id,
        body.called_at ?? null,
        body.offered_date ?? null,
        body.outcome,
        body.notes ?? null,
        body.next_call_on ?? null,
      );

      if (body.outcome === 'accepted') {
        const date = body.offered_date ?? existing.scheduled_date;
        if (date) {
          db.prepare(
            `UPDATE cases SET scheduled_date = ?, status = 'confirmed',
                    updated_at = datetime('now')
              WHERE id = ?`,
          ).run(date, id);
        }
      } else if (body.outcome === 'declined') {
        db.prepare('DELETE FROM ot_list_entries WHERE case_id = ?').run(id);
        db.prepare(
          `UPDATE cases SET scheduled_date = NULL, status = 'ready',
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(id);
      } else if (body.offered_date && existing.status !== 'confirmed') {
        // Offered but not yet answered — hold the date provisionally.
        db.prepare(
          `UPDATE cases SET scheduled_date = ?, status = 'offered',
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(body.offered_date, id);
      }
    });
    record();

    logActivity('case', id, `call: ${body.outcome}`, body.offered_date ?? undefined);
    res.status(201).json({ case: getCase(id), calls: getCalls(id) });
  }),
);

export const callsRouter = Router();

callsRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const call = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(id) as
      | CallLog
      | undefined;
    if (!call) throw notFound('Call');
    db.prepare('DELETE FROM call_logs WHERE id = ?').run(id);
    res.json(getCalls(call.case_id));
  }),
);
