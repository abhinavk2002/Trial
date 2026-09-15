import type { CaseWithPatient, OtListEntryDetail } from '../types.js';

/** "HH:MM" -> minutes since midnight. Falls back to 09:00 on junk input. */
export function parseTime(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 9 * 60;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return 9 * 60;
  return hours * 60 + minutes;
}

/** Minutes since midnight -> "HH:MM", wrapping past midnight. */
export function formatTime(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function ageFrom(dateOfBirth: string | null, ageYears: number | null): number | null {
  if (typeof ageYears === 'number' && Number.isFinite(ageYears)) return ageYears;
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

const DIABETES_PATTERN = /\bdiabet|\bdm\b|\bt2dm\b|\bt1dm\b|\biddm\b|\bniddm\b/i;

export function looksDiabetic(comorbidities: string | null): boolean {
  return comorbidities ? DIABETES_PATTERN.test(comorbidities) : false;
}

/**
 * Ordering key for a case on an OT list, following the conventions most
 * surgical units run on. Lower sorts earlier.
 *
 *   1. Clean cases before contaminated/infected ones — infected always last,
 *      whatever their priority, so the theatre is not dirtied for the rest.
 *   2. Emergency before urgent before routine.
 *   3. Within a tier: children first, then diabetics, then day-care cases
 *      (all three tolerate a long starvation period least well, or need to be
 *      discharged the same day).
 *   4. Shorter cases before longer ones, so an overrun pushes the fewest
 *      patients.
 *   5. Case id, purely so the order is stable.
 *
 * This is only the opening suggestion — every generated list stays editable.
 */
export function orderingKey(c: CaseWithPatient): number[] {
  const infectedTier = c.is_infected ? 1 : 0;
  const priorityTier = c.priority === 'emergency' ? 0 : c.priority === 'urgent' ? 1 : 2;

  const age = ageFrom(null, c.patient_age);
  let patientTier = 3;
  if (age !== null && age < 12) patientTier = 0;
  else if (looksDiabetic(c.patient_comorbidities)) patientTier = 1;
  else if (c.is_daycare) patientTier = 2;

  return [infectedTier, priorityTier, patientTier, c.duration_min, c.id];
}

export function compareForList(a: CaseWithPatient, b: CaseWithPatient): number {
  const ka = orderingKey(a);
  const kb = orderingKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Human-readable reason a case landed where it did, shown in the UI. */
export function orderingReason(c: CaseWithPatient): string[] {
  const reasons: string[] = [];
  if (c.is_infected) reasons.push('Infected — placed last');
  if (c.priority === 'emergency') reasons.push('Emergency');
  else if (c.priority === 'urgent') reasons.push('Urgent');
  const age = c.patient_age;
  if (age !== null && age < 12) reasons.push('Paediatric — early');
  else if (looksDiabetic(c.patient_comorbidities)) reasons.push('Diabetic — early');
  else if (c.is_daycare) reasons.push('Day care — early');
  return reasons;
}

export interface TimedEntry {
  duration_min: number;
  status: string;
}

/**
 * Walk the running order and stamp each entry with a planned start/end.
 * Cancelled entries take no theatre time but keep a slot in the printout.
 */
export function computeTimes<T extends TimedEntry>(
  entries: T[],
  startTime: string,
  turnoverMin: number,
): (T & { planned_start: string; planned_end: string })[] {
  let cursor = parseTime(startTime);
  const out: (T & { planned_start: string; planned_end: string })[] = [];

  for (const entry of entries) {
    if (entry.status === 'cancelled') {
      out.push({ ...entry, planned_start: '—', planned_end: '—' });
      continue;
    }
    const start = cursor;
    const end = start + Math.max(0, entry.duration_min);
    out.push({ ...entry, planned_start: formatTime(start), planned_end: formatTime(end) });
    cursor = end + Math.max(0, turnoverMin);
  }
  return out;
}

export function totalOperatingMinutes(entries: TimedEntry[], turnoverMin: number): number {
  const active = entries.filter((e) => e.status !== 'cancelled');
  if (active.length === 0) return 0;
  const operating = active.reduce((sum, e) => sum + Math.max(0, e.duration_min), 0);
  return operating + Math.max(0, turnoverMin) * (active.length - 1);
}

export function plannedFinish(entries: OtListEntryDetail[], startTime: string): string {
  const active = entries.filter((e) => e.status !== 'cancelled');
  const last = active[active.length - 1];
  return last ? last.planned_end : startTime;
}
