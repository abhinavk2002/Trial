import { Router } from 'express';
import { db } from '../db.js';
import { listCases } from '../lib/queries.js';
import { listDetail } from './otLists.js';
import { handler } from '../lib/http.js';
import type { OtList } from '../types.js';

export const dashboardRouter = Router();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

dashboardRouter.get(
  '/',
  handler((_req, res) => {
    const now = today();
    const horizon = addDays(now, 21);

    const todaysLists = (
      db.prepare('SELECT * FROM ot_lists WHERE list_date = ? ORDER BY theatre').all(now) as OtList[]
    ).map(listDetail);

    const upcomingLists = db
      .prepare(
        `SELECT l.*,
                (SELECT COUNT(*) FROM ot_list_entries e WHERE e.list_id = l.id) AS case_count
           FROM ot_lists l
          WHERE l.list_date > ? AND l.list_date <= ?
          ORDER BY l.list_date, l.theatre`,
      )
      .all(now, horizon);

    const statusCounts = db
      .prepare('SELECT status, COUNT(*) AS n FROM cases GROUP BY status')
      .all() as { status: string; n: number }[];

    // Everything the consultant has to act on, each as its own worklist.
    const awaitingWorkup = listCases({ status: ['workup'] }).filter(
      (c) => c.workup_total === 0 || c.workup_done < c.workup_total,
    );
    const readyToDate = listCases({ status: ['ready'], undated: true });
    const awaitingConfirmation = listCases({ status: ['offered'] });

    const callsDue = db
      .prepare(
        `SELECT cl.*, p.name AS patient_name, p.phone, c.procedure
           FROM call_logs cl
           JOIN cases c    ON c.id = cl.case_id
           JOIN patients p ON p.id = c.patient_id
          WHERE cl.next_call_on IS NOT NULL
            AND cl.next_call_on <= ?
            AND c.status NOT IN ('done', 'cancelled')
            AND cl.id = (SELECT MAX(id) FROM call_logs x WHERE x.case_id = cl.case_id)
          ORDER BY cl.next_call_on`,
      )
      .all(now);

    // Dated cases with a gap that would stop them going to theatre.
    const notReadyButDated = listCases({
      from: now,
      to: horizon,
      status: ['confirmed', 'listed'],
    }).filter((c) => !c.consent_signed || !c.anaesthetic_clear || c.workup_done < c.workup_total);

    res.json({
      date: now,
      todays_lists: todaysLists,
      upcoming_lists: upcomingLists,
      status_counts: Object.fromEntries(statusCounts.map((s) => [s.status, s.n])),
      awaiting_workup: awaitingWorkup,
      ready_to_date: readyToDate,
      awaiting_confirmation: awaitingConfirmation,
      calls_due: callsDue,
      not_ready_but_dated: notReadyButDated,
      recent_activity: db
        .prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 25')
        .all(),
    });
  }),
);
