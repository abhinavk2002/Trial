import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useMutation, useResource } from '../lib/hooks';
import { Checkbox, ErrorBanner, Field, Modal } from './ui';
import type { PatientSummary, Settings, SurgicalCase } from '../types';

type Draft = {
  patient_id: string;
  diagnosis: string;
  procedure: string;
  laterality: SurgicalCase['laterality'];
  anaesthesia: SurgicalCase['anaesthesia'];
  priority: SurgicalCase['priority'];
  duration_min: string;
  is_daycare: boolean;
  is_infected: boolean;
  needs_icu: boolean;
  needs_frozen: boolean;
  blood_units: string;
  implants: string;
  equipment: string;
  special_notes: string;
  consent_signed: boolean;
  anaesthetic_clear: boolean;
  target_month: string;
};

function toDraft(
  existing: SurgicalCase | undefined,
  patientId: number | undefined,
  defaultDuration: string,
): Draft {
  return {
    patient_id: String(existing?.patient_id ?? patientId ?? ''),
    diagnosis: existing?.diagnosis ?? '',
    procedure: existing?.procedure ?? '',
    laterality: existing?.laterality ?? 'na',
    anaesthesia: existing?.anaesthesia ?? 'ga',
    priority: existing?.priority ?? 'routine',
    duration_min: String(existing?.duration_min ?? defaultDuration),
    is_daycare: Boolean(existing?.is_daycare),
    is_infected: Boolean(existing?.is_infected),
    needs_icu: Boolean(existing?.needs_icu),
    needs_frozen: Boolean(existing?.needs_frozen),
    blood_units: String(existing?.blood_units ?? 0),
    implants: existing?.implants ?? '',
    equipment: existing?.equipment ?? '',
    special_notes: existing?.special_notes ?? '',
    consent_signed: Boolean(existing?.consent_signed),
    anaesthetic_clear: Boolean(existing?.anaesthetic_clear),
    target_month: existing?.target_month ?? '',
  };
}

export default function CaseForm({
  existing,
  patientId,
  onClose,
  onSaved,
}: {
  existing?: SurgicalCase;
  patientId?: number;
  onClose: () => void;
  onSaved: (saved: SurgicalCase) => void;
}) {
  const { data: settings } = useResource<Settings>('/settings');
  const { data: patients } = useResource<PatientSummary[]>(
    existing || patientId ? null : '/patients',
  );
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(existing, patientId, settings?.default_duration_min ?? '60'),
  );
  const { run, pending, error } = useMutation();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      diagnosis: draft.diagnosis,
      procedure: draft.procedure,
      laterality: draft.laterality,
      anaesthesia: draft.anaesthesia,
      priority: draft.priority,
      duration_min: Number(draft.duration_min) || 60,
      is_daycare: draft.is_daycare,
      is_infected: draft.is_infected,
      needs_icu: draft.needs_icu,
      needs_frozen: draft.needs_frozen,
      blood_units: Number(draft.blood_units) || 0,
      implants: draft.implants,
      equipment: draft.equipment,
      special_notes: draft.special_notes,
      consent_signed: draft.consent_signed,
      anaesthetic_clear: draft.anaesthetic_clear,
      target_month: draft.target_month || null,
    };

    const saved = await run(() =>
      existing
        ? api.patch<SurgicalCase>(`/cases/${existing.id}`, body)
        : api.post<SurgicalCase>('/cases', { ...body, patient_id: Number(draft.patient_id) }),
    );
    if (saved) onSaved(saved);
  }

  return (
    <Modal
      title={existing ? 'Edit case' : 'New case'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="case-form" className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : existing ? 'Save changes' : 'Add case'}
          </button>
        </>
      }
    >
      <form id="case-form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorBanner error={error} />

        {!existing && !patientId && (
          <Field label="Patient">
            <select
              value={draft.patient_id}
              required
              onChange={(e) => set('patient_id', e.target.value)}
            >
              <option value="">Choose a patient…</option>
              {(patients ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.mrn ? ` (${p.mrn})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Diagnosis">
          <input
            type="text"
            value={draft.diagnosis}
            required
            autoFocus
            placeholder="e.g. Symptomatic cholelithiasis"
            onChange={(e) => set('diagnosis', e.target.value)}
          />
        </Field>

        <Field label="Planned procedure">
          <input
            type="text"
            value={draft.procedure}
            required
            placeholder="e.g. Laparoscopic cholecystectomy"
            onChange={(e) => set('procedure', e.target.value)}
          />
        </Field>

        <div className="field-row">
          <Field label="Side">
            <select
              value={draft.laterality}
              onChange={(e) => set('laterality', e.target.value as Draft['laterality'])}
            >
              <option value="na">Not applicable</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="bilateral">Bilateral</option>
            </select>
          </Field>

          <Field label="Anaesthesia">
            <select
              value={draft.anaesthesia}
              onChange={(e) => set('anaesthesia', e.target.value as Draft['anaesthesia'])}
            >
              <option value="ga">General</option>
              <option value="sa">Spinal</option>
              <option value="ra">Regional</option>
              <option value="la">Local</option>
              <option value="sedation">Sedation</option>
            </select>
          </Field>

          <Field label="Priority">
            <select
              value={draft.priority}
              onChange={(e) => set('priority', e.target.value as Draft['priority'])}
            >
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </select>
          </Field>
        </div>

        <div className="field-row">
          <Field label="Expected theatre time (min)">
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={draft.duration_min}
              onChange={(e) => set('duration_min', e.target.value)}
            />
          </Field>

          <Field label="Blood units to cross-match">
            <input
              type="number"
              min={0}
              max={50}
              value={draft.blood_units}
              onChange={(e) => set('blood_units', e.target.value)}
            />
          </Field>

          <Field label="Target month" hint="A soft target while waiting for a date.">
            <input
              type="month"
              value={draft.target_month}
              onChange={(e) => set('target_month', e.target.value)}
            />
          </Field>
        </div>

        <div className="field-row">
          <div>
            <Checkbox
              label="Day care — home the same day"
              checked={draft.is_daycare}
              onChange={(v) => set('is_daycare', v)}
            />
            <Checkbox
              label="Infected / contaminated — put last on the list"
              checked={draft.is_infected}
              onChange={(v) => set('is_infected', v)}
            />
            <Checkbox
              label="Post-op ICU bed needed"
              checked={draft.needs_icu}
              onChange={(v) => set('needs_icu', v)}
            />
          </div>
          <div>
            <Checkbox
              label="Frozen section needed"
              checked={draft.needs_frozen}
              onChange={(v) => set('needs_frozen', v)}
            />
            <Checkbox
              label="Consent signed"
              checked={draft.consent_signed}
              onChange={(v) => set('consent_signed', v)}
            />
            <Checkbox
              label="Anaesthetic review done"
              checked={draft.anaesthetic_clear}
              onChange={(v) => set('anaesthetic_clear', v)}
            />
          </div>
        </div>

        <div className="field-row">
          <Field label="Implants / special instruments">
            <input
              type="text"
              value={draft.implants}
              placeholder="e.g. Polypropylene mesh 15x15"
              onChange={(e) => set('implants', e.target.value)}
            />
          </Field>
          <Field label="Equipment">
            <input
              type="text"
              value={draft.equipment}
              placeholder="e.g. Laparoscopy stack, C-arm"
              onChange={(e) => set('equipment', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes for the list">
          <textarea
            value={draft.special_notes}
            placeholder="Anything the theatre team should know on the day"
            onChange={(e) => set('special_notes', e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
