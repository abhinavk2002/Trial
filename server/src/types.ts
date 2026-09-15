export type Sex = 'male' | 'female' | 'other' | 'unknown';
export type Laterality = 'left' | 'right' | 'bilateral' | 'na';
export type Anaesthesia = 'ga' | 'sa' | 'la' | 'ra' | 'sedation';
export type Priority = 'emergency' | 'urgent' | 'routine';

export type CaseStatus =
  | 'workup'
  | 'ready'
  | 'offered'
  | 'confirmed'
  | 'listed'
  | 'done'
  | 'postponed'
  | 'cancelled';

export type CallOutcome = 'accepted' | 'declined' | 'no_answer' | 'callback' | 'deferred';
export type EntryStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export const CASE_STATUSES: CaseStatus[] = [
  'workup',
  'ready',
  'offered',
  'confirmed',
  'listed',
  'done',
  'postponed',
  'cancelled',
];

/** Statuses that mean the case is still live and belongs in the working pool. */
export const ACTIVE_CASE_STATUSES: CaseStatus[] = [
  'workup',
  'ready',
  'offered',
  'confirmed',
  'listed',
];

export interface Patient {
  id: number;
  mrn: string | null;
  name: string;
  sex: Sex;
  date_of_birth: string | null;
  age_years: number | null;
  phone: string | null;
  alt_phone: string | null;
  address: string | null;
  blood_group: string | null;
  allergies: string | null;
  comorbidities: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurgicalCase {
  id: number;
  patient_id: number;
  diagnosis: string;
  procedure: string;
  laterality: Laterality;
  anaesthesia: Anaesthesia;
  priority: Priority;
  status: CaseStatus;
  duration_min: number;
  is_daycare: number;
  is_infected: number;
  needs_icu: number;
  needs_frozen: number;
  blood_units: number;
  implants: string | null;
  equipment: string | null;
  special_notes: string | null;
  consent_signed: number;
  anaesthetic_clear: number;
  scheduled_date: string | null;
  target_month: string | null;
  created_at: string;
  updated_at: string;
}

/** A case joined with the patient columns the UI always needs. */
export interface CaseWithPatient extends SurgicalCase {
  patient_name: string;
  patient_mrn: string | null;
  patient_sex: Sex;
  patient_phone: string | null;
  patient_age: number | null;
  patient_comorbidities: string | null;
  workup_total: number;
  workup_done: number;
}

export interface WorkupItem {
  id: number;
  case_id: number;
  label: string;
  done: number;
  due_date: string | null;
  notes: string | null;
  position: number;
  done_at: string | null;
  created_at: string;
}

export interface CallLog {
  id: number;
  case_id: number;
  called_at: string;
  offered_date: string | null;
  outcome: CallOutcome;
  notes: string | null;
  next_call_on: string | null;
  created_at: string;
}

export interface OtList {
  id: number;
  list_date: string;
  theatre: string;
  session: 'am' | 'pm' | 'full';
  start_time: string;
  turnover_min: number;
  surgeon: string | null;
  anaesthetist: string | null;
  scrub_nurse: string | null;
  notes: string | null;
  locked: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OtListEntry {
  id: number;
  list_id: number;
  case_id: number;
  position: number;
  duration_min: number;
  status: EntryStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** An entry with everything needed to print a line on the list. */
export interface OtListEntryDetail extends OtListEntry {
  planned_start: string;
  planned_end: string;
  patient_id: number;
  patient_name: string;
  patient_mrn: string | null;
  patient_sex: Sex;
  patient_age: number | null;
  patient_phone: string | null;
  patient_comorbidities: string | null;
  patient_allergies: string | null;
  patient_blood_group: string | null;
  diagnosis: string;
  procedure: string;
  laterality: Laterality;
  anaesthesia: Anaesthesia;
  priority: Priority;
  is_daycare: number;
  is_infected: number;
  needs_icu: number;
  needs_frozen: number;
  blood_units: number;
  implants: string | null;
  equipment: string | null;
  special_notes: string | null;
  consent_signed: number;
  anaesthetic_clear: number;
}

export interface OtListDetail extends OtList {
  entries: OtListEntryDetail[];
  total_operating_min: number;
  planned_finish: string;
  /** Confirmed cases dated to this day that are not on the list yet. */
  unlisted_case_ids: number[];
}
