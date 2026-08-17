import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useMutation, useResource, useToast } from '../lib/hooks';
import { Card, Checkbox, Empty, ErrorBanner, Progress, Tag, Toast } from '../components/ui';
import CaseForm from '../components/CaseForm';
import ScheduleDialog from '../components/ScheduleDialog';
import CallDialog from '../components/CallDialog';
import {
  ANAESTHESIA_LABEL,
  formatDate,
  formatDateTime,
  formatDuration,
  LATERALITY_LABEL,
  OUTCOME_LABEL,
  patientLine,
  PRIORITY_LABEL,
  relativeDay,
  STATUS_LABEL,
} from '../lib/format';
import type { CaseDetail as CaseDetailData, WorkupItem } from '../types';

function Flags({ c }: { c: CaseDetailData }) {
  return (
    <div className="row tight">
      <Tag>{ANAESTHESIA_LABEL[c.anaesthesia]}</Tag>
      <Tag>{formatDuration(c.duration_min)}</Tag>
      {c.priority !== 'routine' && <Tag tone="warn">{PRIORITY_LABEL[c.priority]}</Tag>}
      {c.is_daycare === 1 && <Tag tone="ok">Day care</Tag>}
      {c.is_infected === 1 && <Tag tone="danger">Infected — lists last</Tag>}
      {c.needs_icu === 1 && <Tag tone="warn">ICU bed</Tag>}
      {c.needs_frozen === 1 && <Tag tone="warn">Frozen section</Tag>}
      {c.blood_units > 0 && <Tag tone="warn">{c.blood_units} units cross-matched</Tag>}
      <Tag tone={c.consent_signed ? 'ok' : 'danger'}>
        {c.consent_signed ? 'Consent signed' : 'No consent'}
      </Tag>
      <Tag tone={c.anaesthetic_clear ? 'ok' : 'danger'}>
        {c.anaesthetic_clear ? 'Anaesthetic review done' : 'No anaesthetic review'}
      </Tag>
    </div>
  );
}

function Workup({ items, onChanged }: { items: WorkupItem[]; onChanged: () => void }) {
  const { run, error } = useMutation();
  const done = items.filter((i) => i.done).length;

  async function toggle(item: WorkupItem) {
    await run(() => api.patch(`/workup/${item.id}`, { done: item.done ? 0 : 1 }));
    onChanged();
  }

  async function remove(item: WorkupItem) {
    await run(() => api.del(`/workup/${item.id}`));
    onChanged();
  }

  return (
    <>
      <ErrorBanner error={error} />
      {items.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="faint num" style={{ marginBottom: 5 }}>
            {done} of {items.length} complete
          </div>
          <Progress done={done} total={items.length} />
        </div>
      )}

      {items.length === 0 ? (
        <Empty>No checklist on this case.</Empty>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.id} className={`checklist-item ${item.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(item.done)}
                style={{ width: 16, height: 16, marginTop: 3, accentColor: 'var(--accent)' }}
                onChange={() => void toggle(item)}
              />
              <div style={{ flex: 1 }}>
                <label style={{ margin: 0, fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>
                  {item.label}
                </label>
                {item.done_at && <div className="faint">Done {formatDateTime(item.done_at)}</div>}
                {item.due_date && !item.done && (
                  <div className="faint">Due {formatDate(item.due_date)}</div>
                )}
              </div>
              <button className="btn-ghost btn-sm" onClick={() => void remove(item)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useResource<CaseDetailData>(`/cases/${id}`);
  const [editing, setEditing] = useState(false);
  const [dating, setDating] = useState(false);
  const [calling, setCalling] = useState(false);
  const [newWorkup, setNewWorkup] = useState('');
  const { run, error: mutationError } = useMutation();
  const [toast, showToast] = useToast();

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <div className="banner danger">{error}</div>;
  if (!data) return null;

  const c = data;

  async function addWorkupItem(e: FormEvent) {
    e.preventDefault();
    if (!newWorkup.trim()) return;
    const done = await run(() => api.post(`/cases/${c.id}/workup`, { label: newWorkup.trim() }));
    if (done) {
      setNewWorkup('');
      void reload();
    }
  }

  async function applyTemplate() {
    const done = await run(() => api.post(`/cases/${c.id}/workup/apply-template`));
    if (done) {
      showToast('Standard workup added');
      void reload();
    }
  }

  async function unschedule(reason: 'postponed' | 'cancelled' | 'back_to_pool') {
    const label =
      reason === 'cancelled'
        ? 'Cancel this case entirely?'
        : reason === 'postponed'
          ? 'Mark as postponed and take it off the date?'
          : 'Take this patient off the date and put them back in the waiting pool?';
    if (!window.confirm(label)) return;
    const done = await run(() => api.post(`/cases/${c.id}/unschedule`, { reason }));
    if (done) {
      showToast('Case taken off the date');
      void reload();
    }
  }

  async function removeCase() {
    if (!window.confirm('Delete this case and its workup and call history?')) return;
    const done = await run(() => api.del(`/cases/${c.id}`));
    if (done) navigate(`/patients/${c.patient_id}`);
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <Link to={`/patients/${c.patient_id}`} className="faint">
            ← {c.patient_name}
          </Link>
          <h1 style={{ marginTop: 4 }}>
            {c.procedure}
            {c.laterality !== 'na' && (
              <span className="muted" style={{ fontWeight: 500 }}>
                {' '}
                — {LATERALITY_LABEL[c.laterality]}
              </span>
            )}
          </h1>
          <p className="page-sub">
            {c.diagnosis} · {patientLine(c)}
          </p>
        </div>
        <div className="row tight">
          <button onClick={() => setEditing(true)}>Edit case</button>
          <button onClick={() => setCalling(true)}>Log a call</button>
          <button className="btn-primary" onClick={() => setDating(true)}>
            {c.scheduled_date ? 'Change date' : 'Give a date'}
          </button>
        </div>
      </header>

      <ErrorBanner error={mutationError} />

      <div className="row" style={{ gap: 10 }}>
        <Tag
          tone={
            c.status === 'done'
              ? 'ok'
              : c.status === 'cancelled'
                ? 'danger'
                : c.status === 'listed' || c.status === 'confirmed'
                  ? 'accent'
                  : c.status === 'offered'
                    ? 'warn'
                    : 'default'
          }
        >
          {STATUS_LABEL[c.status]}
        </Tag>
        <Flags c={c} />
      </div>

      {c.scheduled_date ? (
        <Card
          title={`Scheduled for ${formatDate(c.scheduled_date)}`}
          actions={
            <>
              <span className="faint">{relativeDay(c.scheduled_date)}</span>
              <a className="btn btn-sm" href={`/api/calendar/cases/${c.id}.ics`}>
                Add to calendar
              </a>
              <Link className="btn btn-sm" to={`/ot-lists?date=${c.scheduled_date}`}>
                Open the OT list
              </Link>
            </>
          }
        >
          {c.status === 'offered' && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              This date is provisional — the patient has not confirmed it yet. Log the call once
              you have spoken to them.
            </div>
          )}

          {c.listings.length > 0 ? (
            <p style={{ marginTop: 0 }}>
              On the {c.listings[0]!.theatre} list, position {c.listings[0]!.position + 1}.
            </p>
          ) : (
            <p style={{ marginTop: 0 }} className="muted">
              Not on an OT list yet. Generate or open the list for that date to add them.
            </p>
          )}

          <div className="row tight">
            <button className="btn-sm" onClick={() => void unschedule('back_to_pool')}>
              Take off this date
            </button>
            <button className="btn-sm" onClick={() => void unschedule('postponed')}>
              Postpone
            </button>
            <button className="btn-sm btn-danger" onClick={() => void unschedule('cancelled')}>
              Cancel case
            </button>
          </div>
        </Card>
      ) : (
        <Card title="No date yet">
          <p style={{ marginTop: 0 }} className="muted">
            {c.workup_total > 0 && c.workup_done < c.workup_total
              ? `Workup is ${c.workup_done} of ${c.workup_total} complete.`
              : 'Workup is complete — this case is ready for a date.'}
            {c.target_month && ` Target month: ${c.target_month}.`}
          </p>
          <button className="btn-primary" onClick={() => setDating(true)}>
            Give a date
          </button>
        </Card>
      )}

      <div className="grid two">
        <Card
          title="Pre-op workup"
          actions={
            <button className="btn-sm" onClick={() => void applyTemplate()}>
              Add standard workup
            </button>
          }
        >
          <Workup items={c.workup} onChanged={reload} />
          <form className="row tight" style={{ marginTop: 12 }} onSubmit={(e) => void addWorkupItem(e)}>
            <input
              type="text"
              value={newWorkup}
              placeholder="Add an investigation or step…"
              style={{ flex: 1, minWidth: 180 }}
              onChange={(e) => setNewWorkup(e.target.value)}
            />
            <button type="submit">Add</button>
          </form>
        </Card>

        <Card
          title="Call history"
          actions={
            <button className="btn-sm" onClick={() => setCalling(true)}>
              Log a call
            </button>
          }
          tight
        >
          {c.calls.length === 0 ? (
            <Empty>No calls logged yet.</Empty>
          ) : (
            <table>
              <tbody>
                {c.calls.map((call) => (
                  <tr key={call.id}>
                    <td>
                      <strong>{OUTCOME_LABEL[call.outcome]}</strong>
                      {call.offered_date && (
                        <div className="faint">Date discussed: {formatDate(call.offered_date)}</div>
                      )}
                      {call.notes && <div className="muted">{call.notes}</div>}
                      {call.next_call_on && (
                        <div style={{ marginTop: 4 }}>
                          <Tag tone="warn">Ring back {formatDate(call.next_call_on)}</Tag>
                        </div>
                      )}
                    </td>
                    <td className="faint" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatDateTime(call.called_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {(c.implants || c.equipment || c.special_notes) && (
        <Card title="For the theatre team">
          {c.implants && (
            <p style={{ marginTop: 0 }}>
              <strong>Implants / instruments:</strong> {c.implants}
            </p>
          )}
          {c.equipment && (
            <p>
              <strong>Equipment:</strong> {c.equipment}
            </p>
          )}
          {c.special_notes && (
            <p style={{ marginBottom: 0 }}>
              <strong>Notes:</strong> {c.special_notes}
            </p>
          )}
        </Card>
      )}

      <Card title="Quick updates">
        <div className="field-row">
          <Checkbox
            label="Consent signed"
            checked={Boolean(c.consent_signed)}
            onChange={async (v) => {
              await run(() => api.patch(`/cases/${c.id}`, { consent_signed: v }));
              void reload();
            }}
          />
          <Checkbox
            label="Anaesthetic review done"
            checked={Boolean(c.anaesthetic_clear)}
            onChange={async (v) => {
              await run(() => api.patch(`/cases/${c.id}`, { anaesthetic_clear: v }));
              void reload();
            }}
          />
        </div>
      </Card>

      <div>
        <button className="btn-danger btn-sm" onClick={() => void removeCase()}>
          Delete case
        </button>
      </div>

      {editing && (
        <CaseForm
          existing={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}

      {dating && (
        <ScheduleDialog
          surgicalCase={c}
          onClose={() => setDating(false)}
          onSaved={() => {
            setDating(false);
            showToast('Date saved');
            void reload();
          }}
        />
      )}

      {calling && (
        <CallDialog
          surgicalCase={c}
          onClose={() => setCalling(false)}
          onSaved={() => {
            setCalling(false);
            showToast('Call logged');
            void reload();
          }}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
