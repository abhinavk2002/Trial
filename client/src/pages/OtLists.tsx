import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useMutation, useResource, useToast } from '../lib/hooks';
import { Card, Empty, ErrorBanner, Field, Modal, Tag, Toast } from '../components/ui';
import {
  addDays,
  ANAESTHESIA_LABEL,
  ENTRY_STATUS_LABEL,
  formatDate,
  formatDuration,
  LATERALITY_LABEL,
  patientLine,
  relativeDay,
  todayISO,
} from '../lib/format';
import type { DayView, OtList, OtListEntry, Settings, SurgicalCase } from '../types';

// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  index,
  total,
  locked,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
  onEdit,
  onRemove,
  onStatus,
}: {
  entry: OtListEntry;
  index: number;
  total: number;
  locked: boolean;
  onMove: (from: number, to: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  isDragging: boolean;
  isDropTarget: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onStatus: (status: OtListEntry['status']) => void;
}) {
  return (
    <div
      className={[
        'entry',
        entry.status,
        isDragging ? 'dragging' : '',
        isDropTarget ? 'drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable={!locked}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div>
        <div
          className="entry-handle no-print"
          title={locked ? 'Unlock the list to reorder' : 'Drag to reorder'}
          aria-hidden="true"
        >
          {locked ? '·' : '⋮⋮'}
        </div>
        <div className="entry-pos">{index + 1}</div>
      </div>

      <div className="entry-time">
        {entry.planned_start}
        <small>{entry.planned_end}</small>
      </div>

      <div>
        <div className="entry-patient">
          <Link to={`/cases/${entry.case_id}`}>{entry.patient_name}</Link>{' '}
          <span className="faint" style={{ fontWeight: 400 }}>
            {patientLine(entry)}
          </span>
        </div>
        <div className="entry-procedure">
          {entry.procedure}
          {entry.laterality !== 'na' && (
            <strong> — {LATERALITY_LABEL[entry.laterality]}</strong>
          )}
        </div>
        <div className="faint">{entry.diagnosis}</div>

        <div className="entry-meta">
          <Tag>{ANAESTHESIA_LABEL[entry.anaesthesia]}</Tag>
          <Tag>{formatDuration(entry.duration_min)}</Tag>
          {entry.priority !== 'routine' && <Tag tone="warn">{entry.priority}</Tag>}
          {entry.is_infected === 1 && <Tag tone="danger">infected</Tag>}
          {entry.is_daycare === 1 && <Tag tone="ok">day care</Tag>}
          {entry.needs_icu === 1 && <Tag tone="warn">ICU bed</Tag>}
          {entry.needs_frozen === 1 && <Tag tone="warn">frozen section</Tag>}
          {entry.blood_units > 0 && <Tag tone="warn">{entry.blood_units} units</Tag>}
          {entry.patient_allergies && <Tag tone="danger">allergy: {entry.patient_allergies}</Tag>}
          {!entry.consent_signed && <Tag tone="danger">no consent</Tag>}
          {!entry.anaesthetic_clear && <Tag tone="danger">no anaesthetic review</Tag>}
        </div>

        {(entry.implants || entry.equipment || entry.special_notes || entry.notes) && (
          <div className="faint" style={{ marginTop: 6 }}>
            {[entry.implants, entry.equipment, entry.special_notes, entry.notes]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>

      <div className="entry-actions no-print">
        <select
          value={entry.status}
          aria-label="Case status"
          style={{ width: 'auto', fontSize: 13, padding: '4px 6px' }}
          onChange={(e) => onStatus(e.target.value as OtListEntry['status'])}
        >
          {(['planned', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {ENTRY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        {!locked && (
          <>
            <button
              className="btn-sm btn-ghost"
              disabled={index === 0}
              title="Move up"
              onClick={() => onMove(index, index - 1)}
            >
              ↑
            </button>
            <button
              className="btn-sm btn-ghost"
              disabled={index === total - 1}
              title="Move down"
              onClick={() => onMove(index, index + 1)}
            >
              ↓
            </button>
            <button className="btn-sm" onClick={onEdit}>
              Edit
            </button>
            <button className="btn-sm btn-danger" onClick={onRemove}>
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PrintView({ list }: { list: OtList }) {
  return (
    <div className="print-only">
      <div className="print-head">
        <h2 style={{ fontSize: '14pt' }}>
          Operating list — {formatDate(list.list_date)} — {list.theatre}
        </h2>
        <p style={{ margin: '4px 0', fontSize: '10pt' }}>
          Start {list.start_time} · planned finish {list.planned_finish} ·{' '}
          {list.entries.filter((e) => e.status !== 'cancelled').length} cases
          {list.surgeon ? ` · Surgeon: ${list.surgeon}` : ''}
          {list.anaesthetist ? ` · Anaesthetist: ${list.anaesthetist}` : ''}
          {list.scrub_nurse ? ` · Scrub: ${list.scrub_nurse}` : ''}
        </p>
        {list.notes && <p style={{ margin: '4px 0', fontSize: '10pt' }}>{list.notes}</p>}
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '4%' }}>#</th>
            <th style={{ width: '9%' }}>Time</th>
            <th style={{ width: '20%' }}>Patient</th>
            <th style={{ width: '12%' }}>Hosp. no.</th>
            <th style={{ width: '27%' }}>Procedure</th>
            <th style={{ width: '8%' }}>Anaes.</th>
            <th style={{ width: '20%' }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {list.entries.map((e, i) => (
            <tr key={e.id}>
              <td>{i + 1}</td>
              <td>{e.planned_start}</td>
              <td>
                {e.patient_name}
                <br />
                {patientLine(e).replace(` · ${e.patient_mrn ?? ''}`, '')}
              </td>
              <td>{e.patient_mrn ?? '—'}</td>
              <td>
                {e.procedure}
                {e.laterality !== 'na' ? ` — ${LATERALITY_LABEL[e.laterality]}` : ''}
                <br />
                <em>{e.diagnosis}</em>
              </td>
              <td>{ANAESTHESIA_LABEL[e.anaesthesia]}</td>
              <td>
                {[
                  e.status === 'cancelled' ? 'CANCELLED' : '',
                  e.is_infected ? 'Infected' : '',
                  e.blood_units > 0 ? `${e.blood_units} u blood` : '',
                  e.needs_icu ? 'ICU bed' : '',
                  e.needs_frozen ? 'Frozen section' : '',
                  e.patient_allergies ? `Allergy: ${e.patient_allergies}` : '',
                  e.implants,
                  e.equipment,
                  e.special_notes,
                ]
                  .filter(Boolean)
                  .join('; ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ListHeaderForm({
  list,
  theatres,
  onClose,
  onSaved,
}: {
  list: OtList;
  theatres: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    list_date: list.list_date,
    theatre: list.theatre,
    start_time: list.start_time,
    turnover_min: String(list.turnover_min),
    surgeon: list.surgeon ?? '',
    anaesthetist: list.anaesthetist ?? '',
    scrub_nurse: list.scrub_nurse ?? '',
    notes: list.notes ?? '',
  });
  const { run, pending, error } = useMutation();
  const dateChanged = draft.list_date !== list.list_date;

  async function save() {
    const done = await run(() =>
      api.patch(`/ot-lists/${list.id}`, {
        ...draft,
        turnover_min: Number(draft.turnover_min) || 0,
      }),
    );
    if (done) onSaved();
  }

  return (
    <Modal
      title="List details"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />

      <div className="field-row">
        <Field label="Date">
          <input
            type="date"
            value={draft.list_date}
            onChange={(e) => setDraft({ ...draft, list_date: e.target.value })}
          />
        </Field>
        <Field label="Theatre">
          <select
            value={draft.theatre}
            onChange={(e) => setDraft({ ...draft, theatre: e.target.value })}
          >
            {[...new Set([list.theatre, ...theatres])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {dateChanged && (
        <div className="banner warn" style={{ marginBottom: 14 }}>
          Moving the list also moves all {list.entries.length} patient(s) on it to{' '}
          {formatDate(draft.list_date)}. Remember to ring them.
        </div>
      )}

      <div className="field-row">
        <Field label="Start time">
          <input
            type="time"
            value={draft.start_time}
            onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
          />
        </Field>
        <Field label="Turnover between cases (min)">
          <input
            type="number"
            min={0}
            max={180}
            step={5}
            value={draft.turnover_min}
            onChange={(e) => setDraft({ ...draft, turnover_min: e.target.value })}
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Surgeon">
          <input
            type="text"
            value={draft.surgeon}
            onChange={(e) => setDraft({ ...draft, surgeon: e.target.value })}
          />
        </Field>
        <Field label="Anaesthetist">
          <input
            type="text"
            value={draft.anaesthetist}
            onChange={(e) => setDraft({ ...draft, anaesthetist: e.target.value })}
          />
        </Field>
        <Field label="Scrub nurse">
          <input
            type="text"
            value={draft.scrub_nurse}
            onChange={(e) => setDraft({ ...draft, scrub_nurse: e.target.value })}
          />
        </Field>
      </div>

      <Field label="List notes">
        <textarea
          value={draft.notes}
          placeholder="Anything the theatre team should know about the session"
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function EntryEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: OtListEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [duration, setDuration] = useState(String(entry.duration_min));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const { run, pending, error } = useMutation();

  async function save() {
    const done = await run(() =>
      api.patch(`/ot-list-entries/${entry.id}`, {
        duration_min: Number(duration) || entry.duration_min,
        notes,
      }),
    );
    if (done) onSaved();
  }

  return (
    <Modal
      title={`${entry.patient_name} — ${entry.procedure}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <Field
        label="Theatre time for this list (min)"
        hint="Changes the running order times without altering the case's usual estimate."
      >
        <input
          type="number"
          min={5}
          max={1440}
          step={5}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
      </Field>
      <Field label="Note on the list">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function ListPanel({
  list,
  theatres,
  onChanged,
  showToast,
}: {
  list: OtList;
  theatres: string[];
  onChanged: () => void;
  showToast: (message: string) => void;
}) {
  const { run, error } = useMutation();
  const [order, setOrder] = useState<OtListEntry[]>(list.entries);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OtListEntry | null>(null);

  // The server owns the order; local state only exists so a drag feels instant.
  useEffect(() => setOrder(list.entries), [list.entries]);

  const locked = list.locked === 1;

  async function commitOrder(next: OtListEntry[]) {
    setOrder(next);
    const done = await run(() =>
      api.post(`/ot-lists/${list.id}/reorder`, { entry_ids: next.map((e) => e.id) }),
    );
    if (done) onChanged();
    else setOrder(list.entries);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    void commitOrder(next);
  }

  async function autoOrder() {
    const done = await run(() => api.post(`/ot-lists/${list.id}/auto-order`));
    if (done) {
      showToast('Running order reset to the suggested order');
      onChanged();
    }
  }

  async function setStatus(entry: OtListEntry, status: OtListEntry['status']) {
    const done = await run(() => api.patch(`/ot-list-entries/${entry.id}`, { status }));
    if (done) onChanged();
  }

  async function removeEntry(entry: OtListEntry) {
    const keepDate = window.confirm(
      `Take ${entry.patient_name} off this list?\n\n` +
        'OK  — keep their date, just remove them from the running order.\n' +
        'Cancel — I want to choose something else.',
    );
    if (!keepDate) return;
    const done = await run(() => api.del(`/ot-list-entries/${entry.id}`, { keep_date: true }));
    if (done) {
      showToast(`${entry.patient_name} removed from the list`);
      onChanged();
    }
  }

  async function addCase(c: SurgicalCase) {
    const done = await run(() => api.post(`/ot-lists/${list.id}/entries`, { case_id: c.id }));
    if (done) {
      showToast(`${c.patient_name} added to the list`);
      onChanged();
    }
  }

  async function toggleLock() {
    const done = await run(() => api.patch(`/ot-lists/${list.id}`, { locked: locked ? 0 : 1 }));
    if (done) {
      showToast(locked ? 'List unlocked' : 'List locked — it will not change by itself');
      onChanged();
    }
  }

  async function removeList() {
    if (
      !window.confirm(
        'Delete this list? The patients keep their date — only the running order goes away.',
      )
    )
      return;
    const done = await run(() => api.del(`/ot-lists/${list.id}`));
    if (done) {
      showToast('List deleted');
      onChanged();
    }
  }

  const activeCases = order.filter((e) => e.status !== 'cancelled').length;

  return (
    <>
      <Card
        title={
          <div>
            <h2>{list.theatre}</h2>
            <div className="faint">
              {list.start_time}–{list.planned_finish} · {activeCases} case
              {activeCases === 1 ? '' : 's'} · {formatDuration(list.total_operating_min)} of
              operating
              {list.surgeon ? ` · ${list.surgeon}` : ''}
            </div>
          </div>
        }
        actions={
          <>
            {locked && <Tag tone="ok">Locked</Tag>}
            <button className="btn-sm" onClick={() => setEditingHeader(true)}>
              List details
            </button>
            <button className="btn-sm" onClick={() => void toggleLock()}>
              {locked ? 'Unlock' : 'Lock list'}
            </button>
            <button className="btn-sm" onClick={() => window.print()}>
              Print
            </button>
          </>
        }
        tight
        className="no-print"
      >
        <ErrorBanner error={error} />

        {!list.order_matches_suggestion && !locked && (
          <div className="banner info no-print" style={{ margin: 12 }}>
            <span>
              The running order differs from the suggested surgical order (children and
              diabetics early, infected cases last).
            </span>
            <button className="btn-sm" onClick={() => void autoOrder()}>
              Use the suggested order
            </button>
          </div>
        )}

        {list.notes && (
          <div className="banner warn no-print" style={{ margin: 12 }}>
            {list.notes}
          </div>
        )}

        {order.length === 0 ? (
          <Empty>No cases on this list yet — add one from the panel below.</Empty>
        ) : (
          <div onDragEnd={() => (setDragFrom(null), setDragOver(null))}>
            {order.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                index={index}
                total={order.length}
                locked={locked}
                isDragging={dragFrom === index}
                isDropTarget={dragOver === index && dragFrom !== index}
                onMove={move}
                onDragStart={setDragFrom}
                onDragOver={setDragOver}
                onDrop={() => {
                  if (dragFrom !== null && dragOver !== null && dragFrom !== dragOver) {
                    move(dragFrom, dragOver);
                  }
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onEdit={() => setEditingEntry(entry)}
                onRemove={() => void removeEntry(entry)}
                onStatus={(s) => void setStatus(entry, s)}
              />
            ))}
          </div>
        )}
      </Card>

      <PrintView list={list} />

      {list.available_cases.length > 0 && (
        <Card
          title={`Dated for this day but not on the list (${list.available_cases.length})`}
          tight
          className="no-print"
        >
          <table>
            <tbody>
              {list.available_cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.patient_name}
                    </Link>
                    <div className="faint">{patientLine(c)}</div>
                  </td>
                  <td>
                    {c.procedure}
                    <div className="faint">{formatDuration(c.duration_min)}</div>
                  </td>
                  <td>
                    <div className="row tight">
                      {c.status === 'offered' && <Tag tone="warn">not confirmed</Tag>}
                      {(c.ordering_reasons ?? []).map((r) => (
                        <Tag key={r}>{r}</Tag>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-sm btn-primary" disabled={locked} onClick={() => void addCase(c)}>
                      Add to list
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="no-print">
        <button className="btn-danger btn-sm" onClick={() => void removeList()}>
          Delete this list
        </button>
      </div>

      {editingHeader && (
        <ListHeaderForm
          list={list}
          theatres={theatres}
          onClose={() => setEditingHeader(false)}
          onSaved={() => {
            setEditingHeader(false);
            showToast('List updated');
            onChanged();
          }}
        />
      )}

      {editingEntry && (
        <EntryEditor
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={() => {
            setEditingEntry(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function OtLists() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayISO();
  const [toast, showToast] = useToast();
  const { run, error: mutationError } = useMutation();

  const { data: settings } = useResource<Settings>('/settings');
  const { data, loading, reload } = useResource<DayView>(`/ot-lists/by-date/${date}`);
  const theatres = settings?.theatres ?? ['OT 1'];

  // Default the theatre picker once settings arrive, without clobbering a choice.
  const [theatre, setTheatre] = useState('');
  const firstTheatre = theatres[0] ?? 'OT 1';
  useEffect(() => {
    setTheatre((current) => current || firstTheatre);
  }, [firstTheatre]);

  function setDate(next: string) {
    setParams(next === todayISO() ? {} : { date: next });
  }

  async function generate() {
    const created = await run(() =>
      api.post<OtList>('/ot-lists/generate', { date, theatre: theatre || theatres[0] }),
    );
    if (created) {
      showToast(
        created.added
          ? `List ready — ${created.added} case${created.added === 1 ? '' : 's'} added`
          : 'List created — no dated cases to add yet',
      );
      void reload();
    }
  }

  const lists = data?.lists ?? [];
  const unlisted = data?.available_cases ?? [];

  return (
    <div className="stack">
      <header className="page-head no-print">
        <div>
          <h1>OT lists</h1>
          <p className="page-sub">
            {formatDate(date)} · {relativeDay(date)}
          </p>
        </div>
        <div className="row tight">
          <button onClick={() => setDate(addDays(date,-1))}>←</button>
          <input
            type="date"
            value={date}
            style={{ width: 165 }}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button onClick={() => setDate(addDays(date,1))}>→</button>
          <button onClick={() => setDate(todayISO())}>Today</button>
        </div>
      </header>

      <ErrorBanner error={mutationError} />

      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : lists.length === 0 ? (
        <Card title="No list for this day yet" className="no-print">
          {unlisted.length === 0 ? (
            <>
              <p style={{ marginTop: 0 }} className="muted">
                Nothing is dated for {formatDate(date)}. Give patients this date from{' '}
                <Link to="/schedule">Scheduling</Link> and the list will build itself.
              </p>
              <div className="row tight">
                <select
                  value={theatre}
                  style={{ width: 'auto' }}
                  onChange={(e) => setTheatre(e.target.value)}
                >
                  {theatres.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button onClick={() => void generate()}>Create an empty list anyway</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{unlisted.length}</strong> patient{unlisted.length === 1 ? ' is' : 's are'}{' '}
                dated for {formatDate(date)}. Generate the list and they will be put in a
                sensible running order — children and diabetics early, infected cases last —
                which you can then change however you like.
              </p>

              <table style={{ marginBottom: 16 }}>
                <tbody>
                  {unlisted.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.patient_name}</strong>
                        <div className="faint">{patientLine(c)}</div>
                      </td>
                      <td>
                        {c.procedure}
                        <div className="faint">{formatDuration(c.duration_min)}</div>
                      </td>
                      <td>
                        <div className="row tight">
                          {c.status === 'offered' && <Tag tone="warn">not confirmed</Tag>}
                          {(c.ordering_reasons ?? []).map((r) => (
                            <Tag key={r}>{r}</Tag>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="row tight">
                <select
                  value={theatre}
                  style={{ width: 'auto' }}
                  onChange={(e) => setTheatre(e.target.value)}
                >
                  {theatres.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button className="btn-primary" onClick={() => void generate()}>
                  Generate the OT list
                </button>
              </div>
            </>
          )}
        </Card>
      ) : (
        <>
          {lists.map((list) => (
            <ListPanel
              key={list.id}
              list={list}
              theatres={theatres}
              onChanged={reload}
              showToast={showToast}
            />
          ))}

          <Card title="Another theatre running that day?" className="no-print">
            <div className="row tight">
              <select
                value={theatre}
                style={{ width: 'auto' }}
                onChange={(e) => setTheatre(e.target.value)}
              >
                {theatres.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <button onClick={() => void generate()}>
                Generate a list for {theatre || theatres[0]}
              </button>
            </div>
            <p className="hint">
              Running the same theatre again just tops the existing list up with anything newly
              dated — it never reshuffles what you have already arranged.
            </p>
          </Card>
        </>
      )}

      <Toast message={toast} />
    </div>
  );
}
