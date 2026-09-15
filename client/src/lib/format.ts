import type {
  Anaesthesia,
  CallOutcome,
  CaseStatus,
  EntryStatus,
  Laterality,
  Priority,
  Sex,
} from '../types';

export const STATUS_LABEL: Record<CaseStatus, string> = {
  workup: 'In workup',
  ready: 'Ready to date',
  offered: 'Date offered',
  confirmed: 'Date confirmed',
  listed: 'On an OT list',
  done: 'Operated',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

export const LATERALITY_LABEL: Record<Laterality, string> = {
  left: 'Left',
  right: 'Right',
  bilateral: 'Bilateral',
  na: '—',
};

export const ANAESTHESIA_LABEL: Record<Anaesthesia, string> = {
  ga: 'GA',
  sa: 'Spinal',
  la: 'LA',
  ra: 'Regional',
  sedation: 'Sedation',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  routine: 'Routine',
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  accepted: 'Accepted the date',
  declined: 'Declined the date',
  no_answer: 'No answer',
  callback: 'Will call back',
  deferred: 'Wants to defer',
};

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  planned: 'Planned',
  in_progress: 'In theatre',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const SEX_LABEL: Record<Sex, string> = {
  male: 'M',
  female: 'F',
  other: 'Other',
  unknown: '—',
};

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Thu 20 Aug 2026" — unambiguous, and never a US/UK date-order trap. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateShort(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** SQLite timestamps are UTC but unmarked; render them in local time. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date(`${todayISO()}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function relativeDay(date: string): string {
  const diff = daysUntil(date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 0) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

export function patientLine(p: {
  patient_age: number | null;
  patient_sex: Sex;
  patient_mrn: string | null;
}): string {
  const bits = [
    p.patient_age !== null ? `${p.patient_age} y` : null,
    p.patient_sex !== 'unknown' ? SEX_LABEL[p.patient_sex] : null,
    p.patient_mrn,
  ].filter(Boolean);
  return bits.join(' · ');
}
