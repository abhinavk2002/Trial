import { Link } from 'react-router-dom';
import { useResource } from '../lib/hooks';
import { Card, Empty, Stat, Tag } from '../components/ui';
import {
  ENTRY_STATUS_LABEL,
  formatDate,
  formatDateTime,
  formatDuration,
  patientLine,
  relativeDay,
} from '../lib/format';
import type { Dashboard as DashboardData, SurgicalCase } from '../types';

function CaseList({ cases, empty }: { cases: SurgicalCase[]; empty: string }) {
  if (cases.length === 0) return <Empty>{empty}</Empty>;
  return (
    <table>
      <tbody>
        {cases.map((c) => (
          <tr key={c.id}>
            <td style={{ minWidth: 150 }}>
              <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                {c.patient_name}
              </Link>
              <div className="faint">{patientLine(c)}</div>
            </td>
            <td>
              {c.procedure}
              <div className="faint">{c.diagnosis}</div>
            </td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {c.priority !== 'routine' && <Tag tone="warn">{c.priority}</Tag>}{' '}
              {c.scheduled_date && <Tag tone="accent">{formatDate(c.scheduled_date)}</Tag>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useResource<DashboardData>('/dashboard');

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error) return <div className="banner danger">{error}</div>;
  if (!data) return null;

  const todaysCases = data.todays_lists.reduce((n, l) => n + l.entries.length, 0);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">{formatDate(data.date)}</p>
        </div>
        <Link className="btn btn-primary" to="/ot-lists">
          Open today’s OT list
        </Link>
      </header>

      <div className="grid four">
        <Stat value={todaysCases} label="Cases in theatre today" tone="accent" />
        <Stat value={data.ready_to_date.length} label="Worked up, waiting for a date" />
        <Stat
          value={data.awaiting_confirmation.length}
          label="Dates offered, awaiting an answer"
          tone={data.awaiting_confirmation.length > 0 ? 'warn' : undefined}
        />
        <Stat value={data.status_counts.workup ?? 0} label="Still in workup" />
      </div>

      {data.todays_lists.length > 0 ? (
        data.todays_lists.map((list) => (
          <Card
            key={list.id}
            title={`Today — ${list.theatre}`}
            actions={
              <>
                <span className="faint">
                  {list.start_time}–{list.planned_finish} ·{' '}
                  {formatDuration(list.total_operating_min)} of operating
                </span>
                <Link className="btn btn-sm" to={`/ot-lists?date=${list.list_date}`}>
                  Open list
                </Link>
              </>
            }
            tight
          >
            <table>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Time</th>
                  <th>Patient</th>
                  <th>Procedure</th>
                  <th style={{ width: 120 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{e.planned_start}</td>
                    <td>
                      <Link to={`/cases/${e.case_id}`} style={{ fontWeight: 600 }}>
                        {e.patient_name}
                      </Link>
                      <div className="faint">{patientLine(e)}</div>
                    </td>
                    <td>
                      {e.procedure}
                      <div className="faint">{e.diagnosis}</div>
                    </td>
                    <td>
                      <Tag
                        tone={
                          e.status === 'done'
                            ? 'ok'
                            : e.status === 'in_progress'
                              ? 'warn'
                              : e.status === 'cancelled'
                                ? 'danger'
                                : 'default'
                        }
                      >
                        {ENTRY_STATUS_LABEL[e.status]}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      ) : (
        <Card title="Today">
          <Empty>
            No OT list for today. <Link to="/ot-lists">Generate one</Link> if you are
            operating.
          </Empty>
        </Card>
      )}

      {data.not_ready_but_dated.length > 0 && (
        <Card title="Dated, but not ready for theatre">
          <div className="banner warn" style={{ marginBottom: 12 }}>
            These patients have a date but are missing consent, anaesthetic clearance or
            part of their workup.
          </div>
          <table>
            <tbody>
              {data.not_ready_but_dated.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.patient_name}
                    </Link>
                    <div className="faint">{c.procedure}</div>
                  </td>
                  <td>
                    <div className="row tight">
                      {!c.consent_signed && <Tag tone="danger">No consent</Tag>}
                      {!c.anaesthetic_clear && <Tag tone="danger">No anaesthetic review</Tag>}
                      {c.workup_done < c.workup_total && (
                        <Tag tone="warn">
                          Workup {c.workup_done}/{c.workup_total}
                        </Tag>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatDate(c.scheduled_date)}
                    <div className="faint">
                      {c.scheduled_date && relativeDay(c.scheduled_date)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid two">
        <Card title="Ready to be given a date" tight>
          <CaseList
            cases={data.ready_to_date}
            empty="Nothing waiting — every worked-up case has a date."
          />
        </Card>

        <Card title="Waiting on the patient to confirm" tight>
          <CaseList
            cases={data.awaiting_confirmation}
            empty="No dates are waiting to be confirmed."
          />
        </Card>

        <Card title="Patients to ring back" tight>
          {data.calls_due.length === 0 ? (
            <Empty>No calls due.</Empty>
          ) : (
            <table>
              <tbody>
                {data.calls_due.map((call) => (
                  <tr key={call.id}>
                    <td>
                      <Link to={`/cases/${call.case_id}`} style={{ fontWeight: 600 }}>
                        {call.patient_name}
                      </Link>
                      <div className="faint">{call.procedure}</div>
                    </td>
                    <td className="faint">{call.phone ?? 'No number on file'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Tag tone="warn">Due {formatDate(call.next_call_on)}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Still in workup" tight>
          <CaseList cases={data.awaiting_workup} empty="No cases are mid-workup." />
        </Card>
      </div>

      <div className="grid two">
        <Card title="Coming up" tight>
          {data.upcoming_lists.length === 0 ? (
            <Empty>No OT lists scheduled in the next three weeks.</Empty>
          ) : (
            <table>
              <tbody>
                {data.upcoming_lists.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/ot-lists?date=${l.list_date}`} style={{ fontWeight: 600 }}>
                        {formatDate(l.list_date)}
                      </Link>
                      <div className="faint">{relativeDay(l.list_date)}</div>
                    </td>
                    <td>{l.theatre}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Tag>{l.case_count} cases</Tag> {l.locked ? <Tag tone="ok">Final</Tag> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent changes" tight>
          {data.recent_activity.length === 0 ? (
            <Empty>Nothing yet.</Empty>
          ) : (
            <table>
              <tbody>
                {data.recent_activity.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span style={{ textTransform: 'capitalize' }}>
                        {a.entity.replace('ot_list', 'OT list')}
                      </span>{' '}
                      {a.action}
                      {a.detail && <div className="faint">{a.detail}</div>}
                    </td>
                    <td className="faint" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatDateTime(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
