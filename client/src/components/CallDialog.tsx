import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useMutation } from '../lib/hooks';
import { ErrorBanner, Field, Modal } from './ui';
import { addDays, todayISO } from '../lib/format';
import type { CallOutcome, SurgicalCase } from '../types';

const OUTCOMES: { value: CallOutcome; label: string; effect: string }[] = [
  {
    value: 'accepted',
    label: 'Accepted the date',
    effect: 'Confirms the case for that date.',
  },
  {
    value: 'declined',
    label: 'Declined the date',
    effect: 'Frees the date and puts the patient back in the waiting pool.',
  },
  {
    value: 'callback',
    label: 'Will call back',
    effect: 'Holds the date provisionally and sets a reminder to ring again.',
  },
  {
    value: 'no_answer',
    label: 'No answer',
    effect: 'Sets a reminder to try again.',
  },
  {
    value: 'deferred',
    label: 'Wants to defer',
    effect: 'Logged so you know to offer a later date.',
  },
];

/** Log the availability call and let it move the case along. */
export default function CallDialog({
  surgicalCase,
  onClose,
  onSaved,
}: {
  surgicalCase: SurgicalCase;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>('accepted');
  const [offeredDate, setOfferedDate] = useState(surgicalCase.scheduled_date ?? '');
  const [notes, setNotes] = useState('');
  const [nextCallOn, setNextCallOn] = useState('');
  const { run, pending, error } = useMutation();

  const selected = OUTCOMES.find((o) => o.value === outcome)!;
  const wantsFollowUp = outcome === 'callback' || outcome === 'no_answer' || outcome === 'deferred';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const done = await run(() =>
      api.post(`/cases/${surgicalCase.id}/calls`, {
        outcome,
        offered_date: offeredDate || null,
        notes,
        next_call_on: nextCallOn || null,
      }),
    );
    if (done) onSaved();
  }

  return (
    <Modal
      title={`Log a call to ${surgicalCase.patient_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="call-form" className="btn-primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save call'}
          </button>
        </>
      }
    >
      <form id="call-form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorBanner error={error} />

        {surgicalCase.patient_phone && (
          <p className="muted" style={{ marginTop: 0 }}>
            On file: <a href={`tel:${surgicalCase.patient_phone}`}>{surgicalCase.patient_phone}</a>
          </p>
        )}

        <Field label="What did they say?">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="banner info" style={{ marginBottom: 14 }}>
          {selected.effect}
        </div>

        {outcome !== 'declined' && (
          <Field
            label="Date discussed"
            hint="Leave blank if no specific date was offered on this call."
          >
            <input
              type="date"
              value={offeredDate}
              onChange={(e) => setOfferedDate(e.target.value)}
            />
          </Field>
        )}

        {wantsFollowUp && (
          <Field label="Ring back on">
            <input
              type="date"
              value={nextCallOn}
              min={todayISO()}
              onChange={(e) => setNextCallOn(e.target.value)}
            />
            <div className="row tight" style={{ marginTop: 6 }}>
              {[1, 3, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn-sm"
                  onClick={() => setNextCallOn(addDays(todayISO(), d))}
                >
                  in {d} day{d === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Notes">
          <textarea
            value={notes}
            placeholder="e.g. Checking with work, prefers a Tuesday"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
