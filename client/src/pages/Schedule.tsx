import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../lib/api';
import { useResource } from '../lib/hooks';
import { Card, Empty, Tag } from '../components/ui';
import ScheduleDialog from '../components/ScheduleDialog';
import {
  formatDate,
  formatDuration,
  patientLine,
  STATUS_LABEL,
  todayISO,
} from '../lib/format';
import type { CalendarData, SurgicalCase } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Six weeks of dates starting from the Monday on or before the 1st. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday-first
  const start = new Date(first);
  start.setUTCDate(1 - offset);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export default function Schedule() {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${today}T00:00:00Z`);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  const [selected, setSelected] = useState<string>(today);
  const [datingCase, setDatingCase] = useState<SurgicalCase | null>(null);

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const { data, reload } = useResource<CalendarData>(`/ot-lists/calendar${qs({ from, to })}`);
  const { data: waiting, reload: reloadWaiting } = useResource<SurgicalCase[]>(
    `/cases${qs({ status: 'ready', undated: true })}`,
  );

  const currentMonth = monthKey(new Date(Date.UTC(cursor.year, cursor.month, 1)));
  const selectedCases = (data?.cases ?? []).filter((c) => c.scheduled_date === selected);
  const selectedList = (data?.lists ?? []).find((l) => l.list_date === selected);

  function shiftMonth(delta: number) {
    setCursor(({ year, month }) => {
      const d = new Date(Date.UTC(year, month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(
    'en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Scheduling</h1>
          <p className="page-sub">
            Pick a day to see its load, then date the patients waiting in the pool.
          </p>
        </div>
        <div className="row tight">
          <button onClick={() => shiftMonth(-1)}>← Previous</button>
          <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel}</strong>
          <button onClick={() => shiftMonth(1)}>Next →</button>
        </div>
      </header>

      <div className="cal">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}

        {days.map((date) => {
          const load = data?.days[date];
          const hasList = (data?.lists ?? []).some((l) => l.list_date === date);
          const outside = !date.startsWith(currentMonth);

          return (
            <button
              key={date}
              type="button"
              className={[
                'cal-day',
                outside ? 'outside' : '',
                date === today ? 'today' : '',
                date === selected ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelected(date)}
            >
              <span className="cal-date">{Number(date.slice(8, 10))}</span>
              {load && (
                <>
                  <span className={`cal-chip ${load.confirmed < load.total ? 'tentative' : ''}`}>
                    {load.total} case{load.total === 1 ? '' : 's'}
                    {hasList ? ' · listed' : ''}
                  </span>
                  <span className="cal-load">{formatDuration(load.minutes)}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid two">
        <Card
          title={formatDate(selected)}
          actions={
            selectedCases.length > 0 && (
              <Link className="btn btn-sm btn-primary" to={`/ot-lists?date=${selected}`}>
                {selectedList ? 'Open the OT list' : 'Generate the OT list'}
              </Link>
            )
          }
          tight
        >
          {selectedCases.length === 0 ? (
            <Empty>Nothing booked for this day.</Empty>
          ) : (
            <table>
              <tbody>
                {selectedCases.map((c) => (
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
                    <td style={{ textAlign: 'right' }}>
                      <Tag tone={c.status === 'offered' ? 'warn' : 'accent'}>
                        {STATUS_LABEL[c.status]}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Waiting for a date"
          actions={<span className="faint">{waiting?.length ?? 0} worked up</span>}
          tight
        >
          {!waiting || waiting.length === 0 ? (
            <Empty>Every worked-up case already has a date.</Empty>
          ) : (
            <table>
              <tbody>
                {waiting.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                        {c.patient_name}
                      </Link>
                      <div className="faint">{c.procedure}</div>
                    </td>
                    <td className="faint num">{formatDuration(c.duration_min)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-sm" onClick={() => setDatingCase(c)}>
                        Give a date…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {datingCase && (
        <ScheduleDialog
          surgicalCase={{ ...datingCase, scheduled_date: selected }}
          onClose={() => setDatingCase(null)}
          onSaved={() => {
            setDatingCase(null);
            void reload();
            void reloadWaiting();
          }}
        />
      )}
    </div>
  );
}
