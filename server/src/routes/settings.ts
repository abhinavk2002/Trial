import { Router } from 'express';
import { z } from 'zod';
import { db, DEFAULT_SETTINGS, getSettings, setSetting } from '../db.js';
import { handler, parseBody, timeString } from '../lib/http.js';

export const settingsRouter = Router();

/** Settings stored as JSON arrays, exposed to the client as real arrays. */
const JSON_KEYS = new Set(['theatres', 'workup_template']);

function shaped(): Record<string, unknown> {
  const raw = { ...DEFAULT_SETTINGS, ...getSettings() };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!JSON_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = [];
    }
  }
  return out;
}

const settingsSchema = z.object({
  unit_name: z.string().trim().min(1).optional(),
  theatres: z.array(z.string().trim().min(1)).min(1).optional(),
  workup_template: z.array(z.string().trim().min(1)).optional(),
  default_start_time: timeString.optional(),
  session_am_start: timeString.optional(),
  session_pm_start: timeString.optional(),
  default_turnover_min: z.number().int().min(0).max(180).optional(),
  default_duration_min: z.number().int().min(5).max(1440).optional(),
});

settingsRouter.get(
  '/',
  handler((_req, res) => {
    res.json(shaped());
  }),
);

settingsRouter.put(
  '/',
  handler((req, res) => {
    const body = parseBody(settingsSchema, req.body);
    const apply = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        setSetting(key, JSON_KEYS.has(key) ? JSON.stringify(value) : String(value));
      }
    });
    apply();
    res.json(shaped());
  }),
);
