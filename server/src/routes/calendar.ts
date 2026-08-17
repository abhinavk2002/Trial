import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { getCase } from '../lib/queries.js';
import { buildCalendar, type IcsEvent } from '../lib/ics.js';
import { computeTimes, formatTime, parseTime } from '../lib/scheduling.js';
import { handler, HttpError, idParam, notFound } from '../lib/http.js';
import type { OtList } from '../types.js';

/** Unauthenticated, guarded by the unguessable token in the URL. */
export const calendarFeedRouter = Router();
/** Authenticated single-event downloads. */
export const calendarDownloadRouter = Router();

const LATERALITY_LABEL: Record<string, string> = {
  left: 'Left',
  right: 'Right',
  bilateral: 'Bilateral',
  na: '',
};

const ANAESTHESIA_LABEL: Record<string, string> = {
  ga: 'GA',
  sa: 'Spinal',
  la: 'LA',
  ra: 'Regional',
  sedation: 'Sedation',
};

/** SQLite's datetime('now') is UTC but has no zone marker; SEQUENCE needs one. */
function sequenceFrom(updatedAt: string): number {
  const parsed = Date.parse(`${updatedAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed)) return 0;
  // Seconds since 2020-01-01, small enough to stay well inside a 32-bit int.
  return Math.max(0, Math.floor((parsed - Date.UTC(2020, 0, 1)) / 1000));
}

interface FeedRow {
  case_id: number;
  patient_name: string;
  mrn: string | null;
  phone: string | null;
  diagnosis: string;
  procedure: string;
  laterality: string;
  anaesthesia: string;
  priority: string;
  status: string;
  duration_min: number;
  special_notes: string | null;
  implants: string | null;
  equipment: string | null;
  scheduled_date: string;
  updated_at: string;
  list_id: number | null;
  theatre: string | null;
  list_start: string | null;
  turnover_min: number | null;
  entry_position: number | null;
  entry_status: string | null;
  entry_duration: number | null;
}

const FEED_SQL = `
  SELECT c.id AS case_id, p.name AS patient_name, p.mrn, p.phone,
         c.diagnosis, c.procedure, c.laterality, c.anaesthesia, c.priority,
         c.status, c.duration_min, c.special_notes, c.implants, c.equipment,
         c.scheduled_date, c.updated_at,
         l.id AS list_id, l.theatre, l.start_time AS list_start, l.turnover_min,
         e.position AS entry_position, e.status AS entry_status,
         e.duration_min AS entry_duration
    FROM cases c
    JOIN patients p        ON p.id = c.patient_id
    LEFT JOIN ot_list_entries e ON e.case_id = c.id
    LEFT JOIN ot_lists l        ON l.id = e.list_id
   WHERE c.scheduled_date IS NOT NULL
     AND c.scheduled_date >= ?
     AND c.status NOT IN ('cancelled')
   ORDER BY c.scheduled_date, l.theatre, e.position
`;

function describe(row: FeedRow): string {
  const lines = [
    `Patient: ${row.patient_name}${row.mrn ? ` (${row.mrn})` : ''}`,
    `Diagnosis: ${row.diagnosis}`,
    `Procedure: ${row.procedure}${
      LATERALITY_LABEL[row.laterality] ? ` — ${LATERALITY_LABEL[row.laterality]}` : ''
    }`,
    `Anaesthesia: ${ANAESTHESIA_LABEL[row.anaesthesia] ?? row.anaesthesia}`,
    `Planned duration: ${row.entry_duration ?? row.duration_min} min`,
  ];
  if (row.priority !== 'routine') lines.push(`Priority: ${row.priority.toUpperCase()}`);
  if (row.theatre) lines.push(`Theatre: ${row.theatre}`);
  if (row.phone) lines.push(`Contact: ${row.phone}`);
  if (row.implants) lines.push(`Implants/instruments: ${row.implants}`);
  if (row.equipment) lines.push(`Equipment: ${row.equipment}`);
  if (row.special_notes) lines.push(`Notes: ${row.special_notes}`);
  if (row.status === 'offered') {
    lines.push('Status: date offered, awaiting the patient’s confirmation');
  }
  return lines.join('\n');
}

function summarise(row: FeedRow): string {
  const side = LATERALITY_LABEL[row.laterality];
  const provisional = row.status === 'offered' ? '(provisional) ' : '';
  return `${provisional}${row.patient_name} — ${row.procedure}${side ? ` (${side})` : ''}`;
}

/**
 * One event per dated case. A case on an OT list gets its planned slot; a case
 * that only has a date gets an all-day event so it still shows up.
 */
function buildEvents(sinceDate: string, origin: string): IcsEvent[] {
  const rows = db.prepare(FEED_SQL).all(sinceDate) as FeedRow[];

  // Planned start times depend on everything ahead of the case on its list, so
  // walk each list once rather than guessing per row.
  const startTimes = new Map<number, { start: string; end: string }>();
  const byList = new Map<number, FeedRow[]>();
  for (const row of rows) {
    if (row.list_id === null) continue;
    const bucket = byList.get(row.list_id) ?? [];
    bucket.push(row);
    byList.set(row.list_id, bucket);
  }

  for (const listRows of byList.values()) {
    const first = listRows[0];
    if (!first) continue;
    const ordered = [...listRows].sort(
      (a, b) => (a.entry_position ?? 0) - (b.entry_position ?? 0),
    );
    const timed = computeTimes(
      ordered.map((r) => ({
        duration_min: r.entry_duration ?? r.duration_min,
        status: r.entry_status ?? 'planned',
        case_id: r.case_id,
      })),
      first.list_start ?? '09:00',
      first.turnover_min ?? 20,
    );
    for (const t of timed) {
      if (t.planned_start !== '—') {
        startTimes.set(t.case_id, { start: t.planned_start, end: t.planned_end });
      }
    }
  }

  const events: IcsEvent[] = [];
  for (const row of rows) {
    const slot = startTimes.get(row.case_id);
    events.push({
      uid: `case-${row.case_id}@ot-manager`,
      summary: summarise(row),
      description: `${describe(row)}\n\n${origin}/cases/${row.case_id}`,
      location: row.theatre ?? undefined,
      date: row.scheduled_date,
      startTime: slot?.start,
      endTime: slot?.end,
      sequence: sequenceFrom(row.updated_at),
      status:
        row.entry_status === 'cancelled'
          ? 'CANCELLED'
          : row.status === 'offered'
            ? 'TENTATIVE'
            : 'CONFIRMED',
      reminderMinutes: slot ? 60 : undefined,
    });
  }

  // A single all-day banner per theatre day, so the calendar shows the session
  // at a glance without opening every case.
  const lists = db
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM ot_list_entries e WHERE e.list_id = l.id) AS n
         FROM ot_lists l WHERE l.list_date >= ? ORDER BY l.list_date`,
    )
    .all(sinceDate) as (OtList & { n: number })[];

  for (const list of lists) {
    if (list.n === 0) continue;
    const total = db
      .prepare(
        `SELECT COALESCE(SUM(duration_min), 0) AS mins FROM ot_list_entries
          WHERE list_id = ? AND status != 'cancelled'`,
      )
      .get(list.id) as { mins: number };
    const finish = formatTime(
      parseTime(list.start_time) + total.mins + list.turnover_min * Math.max(0, list.n - 1),
    );

    events.push({
      uid: `otlist-${list.id}@ot-manager`,
      summary: `${list.theatre} — ${list.n} case${list.n === 1 ? '' : 's'}`,
      description: [
        `OT list for ${list.list_date}`,
        `Theatre: ${list.theatre}`,
        `Starts ${list.start_time}, planned finish ${finish}`,
        list.surgeon ? `Surgeon: ${list.surgeon}` : '',
        list.anaesthetist ? `Anaesthetist: ${list.anaesthetist}` : '',
        list.notes ?? '',
        '',
        `${origin}/ot-lists?date=${list.list_date}`,
      ]
        .filter(Boolean)
        .join('\n'),
      location: list.theatre,
      date: list.list_date,
      startTime: list.start_time,
      endTime: finish,
      sequence: sequenceFrom(list.updated_at),
    });
  }

  return events;
}

/** Show a couple of months of history so the feed is useful for looking back. */
function historyStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 60);
  return d.toISOString().slice(0, 10);
}

function origin(req: { protocol: string; get(name: string): string | undefined }): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

calendarFeedRouter.get(
  '/:token',
  handler((req, res) => {
    const token = (req.params.token ?? '').replace(/\.ics$/i, '');
    const user = db.prepare('SELECT id, name FROM users WHERE calendar_token = ?').get(token) as
      | { id: number; name: string }
      | undefined;
    if (!user) throw new HttpError(404, 'Unknown calendar feed');

    const name = `${getSetting('unit_name') ?? 'Surgery'} — OT schedule`;
    const ics = buildCalendar(name, buildEvents(historyStart(), origin(req)));

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Content-Disposition', 'inline; filename="ot-schedule.ics"');
    res.send(ics);
  }),
);

/** Single case, for dropping one operation into a calendar by hand. */
calendarDownloadRouter.get(
  '/cases/:id.ics',
  handler((req, res) => {
    const id = idParam(req);
    const found = getCase(id);
    if (!found) throw notFound('Case');
    if (!found.scheduled_date) throw new HttpError(400, 'That case has no date yet');

    const events = buildEvents(found.scheduled_date, origin(req)).filter((e) =>
      e.uid.startsWith(`case-${id}@`),
    );
    if (events.length === 0) throw notFound('Calendar event');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="case-${id}-${found.scheduled_date}.ics"`,
    );
    res.send(buildCalendar(`${found.patient_name} — ${found.procedure}`, events));
  }),
);
