import { Router } from 'express';
import { z } from 'zod';
import { db, getSetting, logActivity } from '../db.js';
import { getCase, listCases } from '../lib/queries.js';
import { listEntryRows } from '../lib/queries.js';
import {
  compareForList,
  computeTimes,
  orderingReason,
  plannedFinish,
  totalOperatingMinutes,
} from '../lib/scheduling.js';
import {
  boolish,
  dateString,
  handler,
  HttpError,
  idParam,
  notFound,
  optionalText,
  parseBody,
  timeString,
} from '../lib/http.js';
import type { CaseWithPatient, OtList, OtListEntry, OtListEntryDetail } from '../types.js';

export const otListsRouter = Router();
export const otEntriesRouter = Router();

function findList(id: number): OtList | undefined {
  return db.prepare('SELECT * FROM ot_lists WHERE id = ?').get(id) as OtList | undefined;
}

/**
 * Cases dated to this day that could go on the list but are not on any list
 * for that date yet. This is what makes a generated list stay open to change:
 * date another patient afterwards and they show up here, ready to be added.
 */
function availableCases(listDate: string): CaseWithPatient[] {
  const listed = db
    .prepare(
      `SELECT e.case_id FROM ot_list_entries e
         JOIN ot_lists l ON l.id = e.list_id
        WHERE l.list_date = ?`,
    )
    .all(listDate) as { case_id: number }[];
  const taken = new Set(listed.map((r) => r.case_id));

  return listCases({ date: listDate, status: ['confirmed', 'offered', 'listed'] })
    .filter((c) => !taken.has(c.id))
    .sort(compareForList);
}

/**
 * Does the current running order still match what the ordering rules would
 * suggest? Topping a list up appends new cases at the end rather than
 * reshuffling a list the consultant may have already tuned, so the UI needs to
 * be able to offer "re-apply the suggested order" when the two have drifted.
 */
function matchesSuggestedOrder(cases: CaseWithPatient[]): boolean {
  const suggested = [...cases].sort(compareForList);
  return cases.every((c, i) => c.id === suggested[i]?.id);
}

export function listDetail(list: OtList) {
  const rows = listEntryRows(list.id);
  const timed = computeTimes(rows, list.start_time, list.turnover_min) as OtListEntryDetail[];

  // Entry order already matches the running order, so this is the sequence to
  // compare the ordering rules against.
  const inOrder = rows
    .map((r) => getCase(r.case_id))
    .filter((c): c is CaseWithPatient => Boolean(c));
  const reasonsByCase = new Map(inOrder.map((c) => [c.id, orderingReason(c)]));

  return {
    ...list,
    entries: timed.map((e) => ({
      ...e,
      ordering_reasons: reasonsByCase.get(e.case_id) ?? [],
    })),
    order_matches_suggestion: matchesSuggestedOrder(inOrder),
    total_operating_min: totalOperatingMinutes(rows, list.turnover_min),
    planned_finish: plannedFinish(timed, list.start_time),
    available_cases: availableCases(list.list_date).map((c) => ({
      ...c,
      ordering_reasons: orderingReason(c),
    })),
  };
}

function renumber(listId: number): void {
  const rows = db
    .prepare('SELECT id FROM ot_list_entries WHERE list_id = ? ORDER BY position, id')
    .all(listId) as { id: number }[];
  const stmt = db.prepare('UPDATE ot_list_entries SET position = ? WHERE id = ?');
  rows.forEach((row, i) => stmt.run(i, row.id));
}

function assertUnlocked(list: OtList, force: boolean): void {
  if (list.locked && !force) {
    throw new HttpError(
      409,
      'This list is locked. Unlock it from the list header to make changes.',
    );
  }
}

function defaultTheatre(): string {
  try {
    const theatres = JSON.parse(getSetting('theatres') ?? '[]');
    return Array.isArray(theatres) && typeof theatres[0] === 'string' ? theatres[0] : 'OT 1';
  } catch {
    return 'OT 1';
  }
}

function sessionStart(session: 'am' | 'pm' | 'full'): string {
  return session === 'pm'
    ? (getSetting('session_pm_start') ?? '13:30')
    : (getSetting('session_am_start') ?? getSetting('default_start_time') ?? '09:00');
}

// ---------------------------------------------------------------------------
// Reading lists
// ---------------------------------------------------------------------------

otListsRouter.get(
  '/',
  handler((req, res) => {
    const { from, to } = req.query;
    const where: string[] = [];
    const params: unknown[] = [];
    if (typeof from === 'string') {
      where.push('list_date >= ?');
      params.push(from);
    }
    if (typeof to === 'string') {
      where.push('list_date <= ?');
      params.push(to);
    }

    const lists = db
      .prepare(
        `SELECT l.*,
                (SELECT COUNT(*) FROM ot_list_entries e WHERE e.list_id = l.id) AS case_count,
                (SELECT COALESCE(SUM(e.duration_min), 0) FROM ot_list_entries e
                  WHERE e.list_id = l.id AND e.status != 'cancelled')            AS operating_min
           FROM ot_lists l
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY l.list_date, l.theatre`,
      )
      .all(...params);

    res.json(lists);
  }),
);

/** Every dated case in a window, for the scheduling calendar. */
otListsRouter.get(
  '/calendar',
  handler((req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const cases = listCases({
      from,
      to,
      status: ['offered', 'confirmed', 'listed', 'done'],
    });

    const byDate: Record<string, { total: number; minutes: number; confirmed: number }> = {};
    for (const c of cases) {
      if (!c.scheduled_date) continue;
      const bucket = (byDate[c.scheduled_date] ??= { total: 0, minutes: 0, confirmed: 0 });
      bucket.total += 1;
      bucket.minutes += c.duration_min;
      if (c.status !== 'offered') bucket.confirmed += 1;
    }

    const lists = db
      .prepare(
        `SELECT id, list_date, theatre, locked, published_at FROM ot_lists
          WHERE (? IS NULL OR list_date >= ?) AND (? IS NULL OR list_date <= ?)`,
      )
      .all(from ?? null, from ?? null, to ?? null, to ?? null);

    res.json({ days: byDate, lists, cases });
  }),
);

otListsRouter.get(
  '/by-date/:date',
  handler((req, res) => {
    const date = dateString.parse(req.params.date);
    const theatre = typeof req.query.theatre === 'string' ? req.query.theatre : undefined;

    const lists = (
      theatre
        ? (db
            .prepare('SELECT * FROM ot_lists WHERE list_date = ? AND theatre = ?')
            .all(date, theatre) as OtList[])
        : (db
            .prepare('SELECT * FROM ot_lists WHERE list_date = ? ORDER BY theatre')
            .all(date) as OtList[])
    ).map(listDetail);

    res.json({
      date,
      lists,
      // Present even when no list exists yet, so the UI can offer to generate one.
      available_cases: availableCases(date).map((c) => ({
        ...c,
        ordering_reasons: orderingReason(c),
      })),
    });
  }),
);

otListsRouter.get(
  '/:id',
  handler((req, res) => {
    const list = findList(idParam(req));
    if (!list) throw notFound('OT list');
    res.json(listDetail(list));
  }),
);

// ---------------------------------------------------------------------------
// Generating a list
// ---------------------------------------------------------------------------

const generateSchema = z.object({
  date: dateString,
  theatre: z.string().trim().min(1).optional(),
  session: z.enum(['am', 'pm', 'full']).default('full'),
  start_time: timeString.optional(),
  turnover_min: z.number().int().min(0).max(180).optional(),
  surgeon: optionalText,
  anaesthetist: optionalText,
  /** Add every dated case for the day, or only the ones listed in case_ids. */
  case_ids: z.array(z.number().int().positive()).optional(),
  force: z.boolean().default(false),
});

/**
 * Create the list for a date if it does not exist, then top it up with any
 * dated case that is not on it yet. Existing rows — including a running order
 * that was hand-tuned — are never disturbed: new cases are appended in the
 * suggested order and can be moved afterwards.
 */
otListsRouter.post(
  '/generate',
  handler((req, res) => {
    const body = parseBody(generateSchema, req.body);
    const theatre = body.theatre ?? defaultTheatre();

    let list = db
      .prepare('SELECT * FROM ot_lists WHERE list_date = ? AND theatre = ?')
      .get(body.date, theatre) as OtList | undefined;

    const isNew = !list;
    if (!list) {
      const info = db
        .prepare(
          `INSERT INTO ot_lists (list_date, theatre, session, start_time, turnover_min,
                                 surgeon, anaesthetist)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          body.date,
          theatre,
          body.session,
          body.start_time ?? sessionStart(body.session),
          body.turnover_min ?? Number(getSetting('default_turnover_min') ?? 20),
          body.surgeon ?? null,
          body.anaesthetist ?? null,
        );
      list = findList(Number(info.lastInsertRowid))!;
    } else {
      assertUnlocked(list, body.force);
    }

    const wanted = availableCases(body.date).filter(
      (c) => !body.case_ids || body.case_ids.includes(c.id),
    );

    const nextPosRow = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM ot_list_entries WHERE list_id = ?')
      .get(list.id) as { pos: number };

    const insertEntry = db.prepare(
      'INSERT INTO ot_list_entries (list_id, case_id, position, duration_min) VALUES (?, ?, ?, ?)',
    );
    const markListed = db.prepare(
      `UPDATE cases SET status = 'listed', updated_at = datetime('now') WHERE id = ?`,
    );

    const addAll = db.transaction((cases: CaseWithPatient[]) => {
      cases.forEach((c, i) => {
        insertEntry.run(list!.id, c.id, nextPosRow.pos + i, c.duration_min);
        markListed.run(c.id);
      });
    });
    addAll(wanted);

    logActivity(
      'ot_list',
      list.id,
      isNew ? 'generated' : 'topped up',
      `${body.date} ${theatre}: added ${wanted.length} case(s)`,
    );

    res.status(isNew ? 201 : 200).json({ ...listDetail(findList(list.id)!), added: wanted.length });
  }),
);

// ---------------------------------------------------------------------------
// Editing a list
// ---------------------------------------------------------------------------

const listPatchSchema = z.object({
  theatre: z.string().trim().min(1).optional(),
  session: z.enum(['am', 'pm', 'full']).optional(),
  start_time: timeString.optional(),
  turnover_min: z.number().int().min(0).max(180).optional(),
  surgeon: optionalText,
  anaesthetist: optionalText,
  scrub_nurse: optionalText,
  notes: optionalText,
  locked: boolish.optional(),
  list_date: dateString.optional(),
});

const LIST_FIELDS = [
  'theatre',
  'session',
  'start_time',
  'turnover_min',
  'surgeon',
  'anaesthetist',
  'scrub_nurse',
  'notes',
  'locked',
  'list_date',
] as const;

otListsRouter.patch(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const list = findList(id);
    if (!list) throw notFound('OT list');

    const body = parseBody(listPatchSchema, req.body);
    const changed = LIST_FIELDS.filter((f) => f in body);

    // Unlocking is always allowed; anything else needs the list to be unlocked.
    const onlyLockChange = changed.length === 1 && changed[0] === 'locked';
    if (!onlyLockChange) assertUnlocked(list, false);

    if (changed.length > 0) {
      const movingDate = 'list_date' in body && body.list_date !== list.list_date;

      const apply = db.transaction(() => {
        db.prepare(
          `UPDATE ot_lists SET ${changed.map((f) => `${f} = ?`).join(', ')},
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(...changed.map((f) => body[f] ?? null), id);

        // Moving a list moves every patient on it — that is the whole point of
        // being able to shift a theatre day.
        if (movingDate) {
          db.prepare(
            `UPDATE cases SET scheduled_date = ?, updated_at = datetime('now')
              WHERE id IN (SELECT case_id FROM ot_list_entries WHERE list_id = ?)`,
          ).run(body.list_date!, id);
        }
      });
      apply();
      logActivity('ot_list', id, 'updated', changed.join(', '));
    }

    res.json(listDetail(findList(id)!));
  }),
);

otListsRouter.post(
  '/:id/publish',
  handler((req, res) => {
    const id = idParam(req);
    if (!findList(id)) throw notFound('OT list');
    db.prepare(
      `UPDATE ot_lists SET published_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
    ).run(id);
    logActivity('ot_list', id, 'published');
    res.json(listDetail(findList(id)!));
  }),
);

otListsRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const list = findList(id);
    if (!list) throw notFound('OT list');

    const drop = db.transaction(() => {
      // The patients keep their date; only the list layout goes away.
      db.prepare(
        `UPDATE cases SET status = 'confirmed', updated_at = datetime('now')
          WHERE status = 'listed'
            AND id IN (SELECT case_id FROM ot_list_entries WHERE list_id = ?)`,
      ).run(id);
      db.prepare('DELETE FROM ot_lists WHERE id = ?').run(id);
    });
    drop();

    logActivity('ot_list', id, 'deleted', `${list.list_date} ${list.theatre}`);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Running order
// ---------------------------------------------------------------------------

const reorderSchema = z.object({ entry_ids: z.array(z.number().int().positive()).min(1) });

otListsRouter.post(
  '/:id/reorder',
  handler((req, res) => {
    const id = idParam(req);
    const list = findList(id);
    if (!list) throw notFound('OT list');
    assertUnlocked(list, false);

    const { entry_ids } = parseBody(reorderSchema, req.body);
    const owned = new Set(
      (
        db.prepare('SELECT id FROM ot_list_entries WHERE list_id = ?').all(id) as {
          id: number;
        }[]
      ).map((r) => r.id),
    );
    if (entry_ids.length !== owned.size || entry_ids.some((e) => !owned.has(e))) {
      throw new HttpError(400, 'The running order must list every entry on this list exactly once');
    }

    const stmt = db.prepare('UPDATE ot_list_entries SET position = ? WHERE id = ?');
    const apply = db.transaction(() => entry_ids.forEach((entryId, i) => stmt.run(i, entryId)));
    apply();

    logActivity('ot_list', id, 'reordered');
    res.json(listDetail(findList(id)!));
  }),
);

/** Throw away hand-tuning and fall back to the suggested surgical order. */
otListsRouter.post(
  '/:id/auto-order',
  handler((req, res) => {
    const id = idParam(req);
    const list = findList(id);
    if (!list) throw notFound('OT list');
    assertUnlocked(list, false);

    const entries = db
      .prepare('SELECT id, case_id FROM ot_list_entries WHERE list_id = ?')
      .all(id) as { id: number; case_id: number }[];

    const cases = entries
      .map((e) => ({ entryId: e.id, data: getCase(e.case_id) }))
      .filter((e): e is { entryId: number; data: CaseWithPatient } => Boolean(e.data))
      .sort((a, b) => compareForList(a.data, b.data));

    const stmt = db.prepare('UPDATE ot_list_entries SET position = ? WHERE id = ?');
    const apply = db.transaction(() => cases.forEach((c, i) => stmt.run(i, c.entryId)));
    apply();

    logActivity('ot_list', id, 'auto-ordered');
    res.json(listDetail(findList(id)!));
  }),
);

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const addEntrySchema = z.object({
  case_id: z.number().int().positive(),
  duration_min: z.number().int().min(5).max(1440).optional(),
  position: z.number().int().min(0).optional(),
});

otListsRouter.post(
  '/:id/entries',
  handler((req, res) => {
    const id = idParam(req);
    const list = findList(id);
    if (!list) throw notFound('OT list');
    assertUnlocked(list, false);

    const body = parseBody(addEntrySchema, req.body);
    const target = getCase(body.case_id);
    if (!target) throw new HttpError(400, 'No such case');

    const already = db
      .prepare('SELECT 1 FROM ot_list_entries WHERE list_id = ? AND case_id = ?')
      .get(id, body.case_id);
    if (already) throw new HttpError(409, 'That case is already on this list');

    const add = db.transaction(() => {
      const next = db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM ot_list_entries WHERE list_id = ?',
        )
        .get(id) as { pos: number };
      const position = body.position ?? next.pos;

      // Make room when inserting into the middle of the running order.
      db.prepare(
        'UPDATE ot_list_entries SET position = position + 1 WHERE list_id = ? AND position >= ?',
      ).run(id, position);

      db.prepare(
        'INSERT INTO ot_list_entries (list_id, case_id, position, duration_min) VALUES (?, ?, ?, ?)',
      ).run(id, body.case_id, position, body.duration_min ?? target.duration_min);

      // Adding a case to a day's list is also what dates it, if it was undated.
      db.prepare(
        `UPDATE cases SET status = 'listed', scheduled_date = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(list.list_date, body.case_id);

      renumber(id);
    });
    add();

    logActivity('ot_list', id, 'case added', `case ${body.case_id}`);
    res.status(201).json(listDetail(findList(id)!));
  }),
);

const entryPatchSchema = z.object({
  duration_min: z.number().int().min(5).max(1440).optional(),
  status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).optional(),
  notes: optionalText,
});

otEntriesRouter.patch(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const entry = db.prepare('SELECT * FROM ot_list_entries WHERE id = ?').get(id) as
      | OtListEntry
      | undefined;
    if (!entry) throw notFound('List entry');

    const list = findList(entry.list_id)!;
    const body = parseBody(entryPatchSchema, req.body);
    // Marking cases done or in progress is how the list is run on the day, so
    // it stays allowed even once the list is locked for editing.
    const onlyStatus = Object.keys(body).length === 1 && 'status' in body;
    if (!onlyStatus) assertUnlocked(list, false);

    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE ot_list_entries SET duration_min = ?, status = ?, notes = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
      ).run(
        body.duration_min ?? entry.duration_min,
        body.status ?? entry.status,
        body.notes === undefined ? entry.notes : body.notes,
        id,
      );

      if (body.status === 'done') {
        db.prepare(
          `UPDATE cases SET status = 'done', updated_at = datetime('now') WHERE id = ?`,
        ).run(entry.case_id);
      } else if (body.status && entry.status === 'done') {
        db.prepare(
          `UPDATE cases SET status = 'listed', updated_at = datetime('now') WHERE id = ?`,
        ).run(entry.case_id);
      }
    });
    apply();

    res.json(listDetail(findList(entry.list_id)!));
  }),
);

const removeEntrySchema = z.object({
  /** Keep the patient's date, or take them off the schedule entirely. */
  keep_date: z.boolean().default(true),
});

otEntriesRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const entry = db.prepare('SELECT * FROM ot_list_entries WHERE id = ?').get(id) as
      | OtListEntry
      | undefined;
    if (!entry) throw notFound('List entry');

    const list = findList(entry.list_id)!;
    assertUnlocked(list, false);
    const { keep_date } = parseBody(removeEntrySchema, req.body ?? {});

    const remove = db.transaction(() => {
      db.prepare('DELETE FROM ot_list_entries WHERE id = ?').run(id);
      if (keep_date) {
        db.prepare(
          `UPDATE cases SET status = 'confirmed', updated_at = datetime('now')
            WHERE id = ? AND status = 'listed'`,
        ).run(entry.case_id);
      } else {
        db.prepare(
          `UPDATE cases SET status = 'ready', scheduled_date = NULL,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(entry.case_id);
      }
      renumber(entry.list_id);
    });
    remove();

    logActivity('ot_list', entry.list_id, 'case removed', `case ${entry.case_id}`);
    res.json(listDetail(findList(entry.list_id)!));
  }),
);
