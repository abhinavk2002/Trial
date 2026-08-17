import { db } from '../db.js';
import type { CaseWithPatient, OtListEntryDetail } from '../types.js';
import { ageFrom } from './scheduling.js';

/** Raw shape returned by the case join, before age is derived. */
type CaseRow = Omit<CaseWithPatient, 'patient_age'> & {
  patient_dob: string | null;
  patient_age_years: number | null;
};

const CASE_SELECT = `
  SELECT c.*,
         p.name          AS patient_name,
         p.mrn           AS patient_mrn,
         p.sex           AS patient_sex,
         p.phone         AS patient_phone,
         p.date_of_birth AS patient_dob,
         p.age_years     AS patient_age_years,
         p.comorbidities AS patient_comorbidities,
         (SELECT COUNT(*) FROM workup_items w WHERE w.case_id = c.id)                  AS workup_total,
         (SELECT COUNT(*) FROM workup_items w WHERE w.case_id = c.id AND w.done = 1)   AS workup_done
    FROM cases c
    JOIN patients p ON p.id = c.patient_id
`;

function toCase(row: CaseRow): CaseWithPatient {
  const { patient_dob, patient_age_years, ...rest } = row;
  return { ...rest, patient_age: ageFrom(patient_dob, patient_age_years) };
}

export function getCase(id: number): CaseWithPatient | undefined {
  const row = db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(id) as CaseRow | undefined;
  return row ? toCase(row) : undefined;
}

export interface CaseFilters {
  status?: string[];
  patientId?: number;
  date?: string;
  from?: string;
  to?: string;
  search?: string;
  undated?: boolean;
}

export function listCases(filters: CaseFilters = {}): CaseWithPatient[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status?.length) {
    where.push(`c.status IN (${filters.status.map(() => '?').join(',')})`);
    params.push(...filters.status);
  }
  if (filters.patientId !== undefined) {
    where.push('c.patient_id = ?');
    params.push(filters.patientId);
  }
  if (filters.date) {
    where.push('c.scheduled_date = ?');
    params.push(filters.date);
  }
  if (filters.from) {
    where.push('c.scheduled_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('c.scheduled_date <= ?');
    params.push(filters.to);
  }
  if (filters.undated) {
    where.push('c.scheduled_date IS NULL');
  }
  if (filters.search) {
    where.push('(p.name LIKE ? OR p.mrn LIKE ? OR c.diagnosis LIKE ? OR c.procedure LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }

  const sql = `${CASE_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE c.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
      COALESCE(c.scheduled_date, '9999-12-31'),
      c.updated_at DESC`;

  return (db.prepare(sql).all(...params) as CaseRow[]).map(toCase);
}

type EntryRow = Omit<OtListEntryDetail, 'patient_age' | 'planned_start' | 'planned_end'> & {
  patient_dob: string | null;
  patient_age_years: number | null;
};

const ENTRY_SELECT = `
  SELECT e.*,
         p.id            AS patient_id,
         p.name          AS patient_name,
         p.mrn           AS patient_mrn,
         p.sex           AS patient_sex,
         p.phone         AS patient_phone,
         p.date_of_birth AS patient_dob,
         p.age_years     AS patient_age_years,
         p.comorbidities AS patient_comorbidities,
         p.allergies     AS patient_allergies,
         p.blood_group   AS patient_blood_group,
         c.diagnosis, c.procedure, c.laterality, c.anaesthesia, c.priority,
         c.is_daycare, c.is_infected, c.needs_icu, c.needs_frozen, c.blood_units,
         c.implants, c.equipment, c.special_notes,
         c.consent_signed, c.anaesthetic_clear
    FROM ot_list_entries e
    JOIN cases c    ON c.id = e.case_id
    JOIN patients p ON p.id = c.patient_id
   WHERE e.list_id = ?
   ORDER BY e.position, e.id
`;

/** Entries for a list, patient details joined in, without planned times yet. */
export function listEntryRows(
  listId: number,
): Omit<OtListEntryDetail, 'planned_start' | 'planned_end'>[] {
  const rows = db.prepare(ENTRY_SELECT).all(listId) as EntryRow[];
  return rows.map(({ patient_dob, patient_age_years, ...rest }) => ({
    ...rest,
    patient_age: ageFrom(patient_dob, patient_age_years),
  }));
}
