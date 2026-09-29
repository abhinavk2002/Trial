import { useState, type FormEvent } from 'react';
import { api, qs } from '../lib/api';
import { useMutation, useResource } from '../lib/hooks';
import { Checkbox, ErrorBanner, Field, Modal, Tag } from './ui';
import { addDays, formatDate, formatDuration, todayISO } from '../lib/format';
import type { SurgicalCase } from '../types';

/**
 * Give a case a date. Shows what is already booked that day so the consultant
 * can see at a glance whether the list has room.
 */
export default function ScheduleDialog({
  surgicalCase,
  onClose,
  onSaved,
}: {
  surgicalCase: SurgicalCase;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(surgicalCase.scheduled_date ?? addDays(todayISO(), 7));
  const [confirmed, setConfirmed] = useState(surgicalCase.status === 'confirmed');
  const [notes, setNotes] = useState('');
  const { run, pending, error } = useMutation();

  // What else is already booked on the chosen day.
  const { data: sameDay } = useResource<SurgicalCase[]>(
    date ? `/cases${qs({ date, status: 'offered,confirmed,listed' })}` : null,
  );

  const others = (sameDay ?? []).filter((c) => c.id !== surgicalCase.id);
  const bookedMinutes = others.reduce((n, c) => n + c.duration_min, 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post(`/cases/${surgicalCase.id}/schedule`, {
        scheduled_date: date,
        confirmed,
        notes,
      }),
    );
    if (done) onSaved();
  }

  return (
    <Modal
      title={`Date ${surgicalCase.patient_name} for surgery`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="schedule-form" className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : confirmed ? 'Confirm this date' : 'Offer this date'}
          </button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorBanner error={error} />

        <p className="muted" style={{ marginTop: 0 }}>
          {surgicalCase.procedure} · {formatDuration(surgicalCase.duration_min)} of theatre time
        </p>

        <Field label="Surgery date">
          <input
            type="date"
            value={date}
            required
            min={todayISO()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        {date && (
          <div className="banner info" style={{ marginBottom: 14 }}>
            <div>
              <strong>{formatDate(date)}</strong>
              <div>
                {others.length === 0
                  ? 'Nothing booked yet — this would be the first case.'
                  : `${others.length} case${others.length === 1 ? '' : 's'} already booked, ${formatDuration(
                      bookedMinutes,
                    )} of theatre time.`}
              </div>
              {others.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {others.map((c) => (
                    <li key={c.id}>
                      {c.patient_name} — {c.procedure} ({formatDuration(c.duration_min)}){' '}
                      {c.status === 'offered' && <Tag tone="warn">provisional</Tag>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <Checkbox
          label="The patient has already agreed to this date"
          checked={confirmed}
          onChange={setConfirmed}
        />
        <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
          Leave this unticked if you are pencilling the date in before ringing them. It stays
          provisional until you log an accepted call.
        </p>

        <Field label="Note (optional)">
          <input
            type="text"
            value={notes}
            placeholder="e.g. Second on the list, needs to be fasted from midnight"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
