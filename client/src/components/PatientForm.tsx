import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useMutation } from '../lib/hooks';
import { Checkbox, ErrorBanner, Field, Modal } from './ui';
import type { Patient } from '../types';

type Draft = {
  name: string;
  mrn: string;
  sex: Patient['sex'];
  date_of_birth: string;
  age_years: string;
  phone: string;
  alt_phone: string;
  address: string;
  blood_group: string;
  allergies: string;
  comorbidities: string;
  notes: string;
};

function toDraft(patient?: Patient): Draft {
  return {
    name: patient?.name ?? '',
    mrn: patient?.mrn ?? '',
    sex: patient?.sex ?? 'unknown',
    date_of_birth: patient?.date_of_birth ?? '',
    age_years: patient?.age_years != null ? String(patient.age_years) : '',
    phone: patient?.phone ?? '',
    alt_phone: patient?.alt_phone ?? '',
    address: patient?.address ?? '',
    blood_group: patient?.blood_group ?? '',
    allergies: patient?.allergies ?? '',
    comorbidities: patient?.comorbidities ?? '',
    notes: patient?.notes ?? '',
  };
}

export default function PatientForm({
  patient,
  onClose,
  onSaved,
}: {
  patient?: Patient;
  onClose: () => void;
  onSaved: (patient: Patient) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(patient));
  // Age is the practical field on a ward; DOB is there when it is known.
  const [useDob, setUseDob] = useState(Boolean(patient?.date_of_birth));
  const { run, pending, error } = useMutation();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...draft,
      date_of_birth: useDob && draft.date_of_birth ? draft.date_of_birth : null,
      age_years: !useDob && draft.age_years ? Number(draft.age_years) : null,
    };

    const saved = await run(() =>
      patient
        ? api.patch<Patient>(`/patients/${patient.id}`, body)
        : api.post<Patient>('/patients', body),
    );
    if (saved) onSaved(saved);
  }

  return (
    <Modal
      title={patient ? `Edit ${patient.name}` : 'New patient'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="patient-form"
            className="btn-primary"
            disabled={pending}
          >
            {pending ? 'Saving…' : 'Save patient'}
          </button>
        </>
      }
    >
      <form id="patient-form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorBanner error={error} />

        <div className="field-row">
          <Field label="Full name">
            <input
              type="text"
              value={draft.name}
              required
              autoFocus
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Hospital number">
            <input type="text" value={draft.mrn} onChange={(e) => set('mrn', e.target.value)} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Sex">
            <select
              value={draft.sex}
              onChange={(e) => set('sex', e.target.value as Patient['sex'])}
            >
              <option value="unknown">Not recorded</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </Field>

          {useDob ? (
            <Field label="Date of birth">
              <input
                type="date"
                value={draft.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Age (years)">
              <input
                type="number"
                min={0}
                max={130}
                value={draft.age_years}
                onChange={(e) => set('age_years', e.target.value)}
              />
            </Field>
          )}

          <Field label="Blood group">
            <input
              type="text"
              value={draft.blood_group}
              placeholder="e.g. B+"
              onChange={(e) => set('blood_group', e.target.value)}
            />
          </Field>
        </div>

        <Checkbox
          label="I have the date of birth rather than the age"
          checked={useDob}
          onChange={setUseDob}
        />

        <div className="field-row">
          <Field label="Phone">
            <input
              type="text"
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="Alternative phone" >
            <input
              type="text"
              value={draft.alt_phone}
              onChange={(e) => set('alt_phone', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Comorbidities" hint="Diabetes here moves the patient earlier on generated lists.">
          <input
            type="text"
            value={draft.comorbidities}
            placeholder="e.g. Type 2 diabetes mellitus, hypertension"
            onChange={(e) => set('comorbidities', e.target.value)}
          />
        </Field>

        <Field label="Allergies">
          <input
            type="text"
            value={draft.allergies}
            placeholder="e.g. Penicillin"
            onChange={(e) => set('allergies', e.target.value)}
          />
        </Field>

        <Field label="Address">
          <input
            type="text"
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>

        <Field label="Notes">
          <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
