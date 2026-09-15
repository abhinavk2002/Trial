import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useMutation, useResource } from '../lib/hooks';
import { Card, Empty, ErrorBanner, Tag } from '../components/ui';
import PatientForm from '../components/PatientForm';
import CaseForm from '../components/CaseForm';
import { formatDate, formatDuration, SEX_LABEL, STATUS_LABEL } from '../lib/format';
import type { PatientDetail as PatientDetailData } from '../types';

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="faint">{label}</div>
      <div>{value || '—'}</div>
    </div>
  );
}

export default function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useResource<PatientDetailData>(`/patients/${id}`);
  const [editing, setEditing] = useState(false);
  const [addingCase, setAddingCase] = useState(false);
  const { run, error: mutationError } = useMutation();

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <div className="banner danger">{error}</div>;
  if (!data) return null;

  async function remove() {
    if (!data) return;
    const ok = window.confirm(
      `Delete ${data.name}? This also deletes their ${data.cases.length} case(s), workup and call history. This cannot be undone.`,
    );
    if (!ok) return;
    const done = await run(() => api.del(`/patients/${data.id}`));
    if (done) navigate('/patients');
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <Link to="/patients" className="faint">
            ← All patients
          </Link>
          <h1 style={{ marginTop: 4 }}>{data.name}</h1>
          <p className="page-sub">
            {[
              data.mrn,
              data.age !== null ? `${data.age} years` : null,
              data.sex !== 'unknown' ? SEX_LABEL[data.sex] : null,
              data.blood_group,
            ]
              .filter(Boolean)
              .join(' · ') || 'No demographics recorded'}
          </p>
        </div>
        <div className="row tight">
          <button onClick={() => setEditing(true)}>Edit details</button>
          <button className="btn-primary" onClick={() => setAddingCase(true)}>
            New case
          </button>
        </div>
      </header>

      <ErrorBanner error={mutationError} />

      {data.allergies && <div className="banner danger">Allergies: {data.allergies}</div>}

      <Card title="Details">
        <div className="grid three">
          <Detail label="Hospital number" value={data.mrn} />
          <Detail label="Phone" value={data.phone} />
          <Detail label="Alternative phone" value={data.alt_phone} />
          <Detail label="Date of birth" value={data.date_of_birth && formatDate(data.date_of_birth)} />
          <Detail label="Blood group" value={data.blood_group} />
          <Detail label="Comorbidities" value={data.comorbidities} />
          <Detail label="Address" value={data.address} />
          <Detail label="Notes" value={data.notes} />
        </div>
      </Card>

      <Card title={`Cases (${data.cases.length})`} tight>
        {data.cases.length === 0 ? (
          <Empty>No cases recorded for this patient yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Procedure</th>
                <th>Diagnosis</th>
                <th style={{ width: 150 }}>Status</th>
                <th style={{ width: 160 }}>Date</th>
                <th style={{ width: 100 }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.procedure}
                    </Link>
                    {c.laterality !== 'na' && <span className="faint"> · {c.laterality}</span>}
                  </td>
                  <td className="muted">{c.diagnosis}</td>
                  <td>
                    <Tag
                      tone={
                        c.status === 'done'
                          ? 'ok'
                          : c.status === 'cancelled'
                            ? 'danger'
                            : c.status === 'listed' || c.status === 'confirmed'
                              ? 'accent'
                              : 'default'
                      }
                    >
                      {STATUS_LABEL[c.status]}
                    </Tag>
                  </td>
                  <td className="muted">{formatDate(c.scheduled_date)}</td>
                  <td className="muted num">{formatDuration(c.duration_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div>
        <button className="btn-danger btn-sm" onClick={() => void remove()}>
          Delete patient
        </button>
      </div>

      {editing && (
        <PatientForm
          patient={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}

      {addingCase && (
        <CaseForm
          patientId={data.id}
          onClose={() => setAddingCase(false)}
          onSaved={(c) => {
            setAddingCase(false);
            navigate(`/cases/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
