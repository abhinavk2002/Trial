import { Router } from 'express';
import { z } from 'zod';
import { db, logActivity } from '../db.js';
import { listCases } from '../lib/queries.js';
import { ageFrom } from '../lib/scheduling.js';
import {
  dateString,
  handler,
  idParam,
  notFound,
  optionalText,
  parseBody,
} from '../lib/http.js';
import type { Patient } from '../types.js';

export const patientsRouter = Router();

const patientSchema = z.object({
  name: z.string().trim().min(1, 'Patient name is required'),
  mrn: optionalText,
  sex: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
  date_of_birth: dateString.nullable().optional(),
  age_years: z.number().int().min(0).max(130).nullable().optional(),
  phone: optionalText,
  alt_phone: optionalText,
  address: optionalText,
  blood_group: optionalText,
  allergies: optionalText,
  comorbidities: optionalText,
  notes: optionalText,
});

const patchSchema = patientSchema.partial();

const FIELDS = [
  'name',
  'mrn',
  'sex',
  'date_of_birth',
  'age_years',
  'phone',
  'alt_phone',
  'address',
  'blood_group',
  'allergies',
  'comorbidities',
  'notes',
] as const;

function withAge(p: Patient) {
  return { ...p, age: ageFrom(p.date_of_birth, p.age_years) };
}

function findPatient(id: number): Patient | undefined {
  return db.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Patient | undefined;
}

patientsRouter.get(
  '/',
  handler((req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const rows = search
      ? (db
          .prepare(
            `SELECT * FROM patients
              WHERE name LIKE ? OR mrn LIKE ? OR phone LIKE ?
              ORDER BY name`,
          )
          .all(`%${search}%`, `%${search}%`, `%${search}%`) as Patient[])
      : (db.prepare('SELECT * FROM patients ORDER BY name').all() as Patient[]);

    // One grouped query beats a per-patient count when the list gets long.
    const counts = db
      .prepare(
        `SELECT patient_id, COUNT(*) AS total,
                SUM(CASE WHEN status IN ('workup','ready','offered','confirmed','listed')
                         THEN 1 ELSE 0 END) AS active
           FROM cases GROUP BY patient_id`,
      )
      .all() as { patient_id: number; total: number; active: number }[];
    const byPatient = new Map(counts.map((c) => [c.patient_id, c]));

    res.json(
      rows.map((p) => ({
        ...withAge(p),
        case_count: byPatient.get(p.id)?.total ?? 0,
        active_case_count: byPatient.get(p.id)?.active ?? 0,
      })),
    );
  }),
);

patientsRouter.get(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const patient = findPatient(id);
    if (!patient) throw notFound('Patient');
    res.json({ ...withAge(patient), cases: listCases({ patientId: id }) });
  }),
);

patientsRouter.post(
  '/',
  handler((req, res) => {
    const body = parseBody(patientSchema, req.body);
    const info = db
      .prepare(
        `INSERT INTO patients (${FIELDS.join(', ')})
         VALUES (${FIELDS.map(() => '?').join(', ')})`,
      )
      .run(...FIELDS.map((f) => body[f] ?? null));

    const id = Number(info.lastInsertRowid);
    logActivity('patient', id, 'created', body.name);
    res.status(201).json(withAge(findPatient(id)!));
  }),
);

patientsRouter.patch(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    const existing = findPatient(id);
    if (!existing) throw notFound('Patient');

    const body = parseBody(patchSchema, req.body);
    const changed = FIELDS.filter((f) => f in body);
    if (changed.length > 0) {
      db.prepare(
        `UPDATE patients SET ${changed.map((f) => `${f} = ?`).join(', ')},
                updated_at = datetime('now')
          WHERE id = ?`,
      ).run(...changed.map((f) => body[f] ?? null), id);
      logActivity('patient', id, 'updated', changed.join(', '));
    }

    res.json(withAge(findPatient(id)!));
  }),
);

patientsRouter.delete(
  '/:id',
  handler((req, res) => {
    const id = idParam(req);
    if (!findPatient(id)) throw notFound('Patient');
    // ON DELETE CASCADE removes the patient's cases, workup and call history.
    db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    logActivity('patient', id, 'deleted');
    res.json({ ok: true });
  }),
);
