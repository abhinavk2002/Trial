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

export interface User {
  id: number;
  email: string;
  name: string;
  calendar_token: string;
}

export interface Patient {
  id: number;
  mrn: string | null;
  name: string;
  sex: Sex;
  date_of_birth: string | null;
  age_years: number | null;
  age: number | null;
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

export interface PatientSummary extends Patient {
  case_count: number;
  active_case_count: number;
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
  patient_name: string;
  patient_mrn: string | null;
  patient_sex: Sex;
  patient_phone: string | null;
  patient_age: number | null;
  patient_comorbidities: string | null;
  workup_total: number;
  workup_done: number;
  ordering_reasons?: string[];
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
}

export interface CallLog {
  id: number;
  case_id: number;
  called_at: string;
  offered_date: string | null;
  outcome: CallOutcome;
  notes: string | null;
  next_call_on: string | null;
}

export interface CaseDetail extends SurgicalCase {
  workup: WorkupItem[];
  calls: CallLog[];
  listings: { list_id: number; list_date: string; theatre: string; position: number }[];
}

export interface PatientDetail extends Patient {
  cases: SurgicalCase[];
}

export interface OtListEntry {
  id: number;
  list_id: number;
  case_id: number;
  position: number;
  duration_min: number;
  status: EntryStatus;
  notes: string | null;
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
  ordering_reasons: string[];
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
  entries: OtListEntry[];
  total_operating_min: number;
  planned_finish: string;
  order_matches_suggestion: boolean;
  available_cases: SurgicalCase[];
  added?: number;
}

export interface OtListSummary {
  id: number;
  list_date: string;
  theatre: string;
  session: 'am' | 'pm' | 'full';
  start_time: string;
  locked: number;
  published_at: string | null;
  case_count: number;
  operating_min: number;
}

export interface DayView {
  date: string;
  lists: OtList[];
  available_cases: SurgicalCase[];
}

export interface CalendarData {
  days: Record<string, { total: number; minutes: number; confirmed: number }>;
  lists: { id: number; list_date: string; theatre: string; locked: number }[];
  cases: SurgicalCase[];
}

export interface CallDue extends CallLog {
  patient_name: string;
  phone: string | null;
  procedure: string;
}

export interface Dashboard {
  date: string;
  todays_lists: OtList[];
  upcoming_lists: (OtListSummary & { case_count: number })[];
  status_counts: Record<string, number>;
  awaiting_workup: SurgicalCase[];
  ready_to_date: SurgicalCase[];
  awaiting_confirmation: SurgicalCase[];
  calls_due: CallDue[];
  not_ready_but_dated: SurgicalCase[];
  recent_activity: {
    id: number;
    entity: string;
    entity_id: number;
    action: string;
    detail: string | null;
    created_at: string;
  }[];
}

export interface Settings {
  unit_name: string;
  theatres: string[];
  workup_template: string[];
  default_start_time: string;
  session_am_start: string;
  session_pm_start: string;
  default_turnover_min: string;
  default_duration_min: string;
}
