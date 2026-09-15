import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { qs } from '../lib/api';
import { useDebounced, useResource } from '../lib/hooks';
import { Card, Empty, Progress, Tag } from '../components/ui';
import CaseForm from '../components/CaseForm';
import {
  ANAESTHESIA_LABEL,
  formatDate,
  formatDuration,
  LATERALITY_LABEL,
  patientLine,
  STATUS_LABEL,
} from '../lib/format';
import type { CaseStatus, SurgicalCase } from '../types';

/** The stages a case moves through, as the consultant thinks about them. */
const GROUPS: { key: string; label: string; statuses: CaseStatus[] }[] = [
  { key: 'active', label: 'Live cases', statuses: ['workup', 'ready', 'offered', 'confirmed', 'listed'] },
  { key: 'workup', label: 'In workup', statuses: ['workup'] },
  { key: 'ready', label: 'Ready to date', statuses: ['ready'] },
  { key: 'waiting', label: 'Offered / confirmed', statuses: ['offered', 'confirmed'] },
  { key: 'listed', label: 'On a list', statuses: ['listed'] },
  { key: 'closed', label: 'Done & cancelled', statuses: ['done', 'cancelled', 'postponed'] },
];

export default function Cases() {
  const [group, setGroup] = useState('active');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  const statuses = useMemo(
    () => GROUPS.find((g) => g.key === group)?.statuses ?? [],
    [group],
  );

  const { data, loading, reload } = useResource<SurgicalCase[]>(
    `/cases${qs({ status: statuses.join(','), search: debounced })}`,
  );

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Cases</h1>
          <p className="page-sub">
            Every operation you are planning, from first workup to theatre.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          New case
        </button>
      </header>

      <div className="tabs">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            className={`tab ${group === g.key ? 'active' : ''}`}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <Card
        title={
          <input
            type="search"
            value={search}
            placeholder="Search patient, diagnosis or procedure…"
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 380 }}
          />
        }
        actions={<span className="faint">{data?.length ?? 0} cases</span>}
        tight
      >
        {loading && !data ? (
          <Empty>Loading…</Empty>
        ) : !data || data.length === 0 ? (
          <Empty>No cases here.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Procedure</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 130 }}>Workup</th>
                <th style={{ width: 150 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`} style={{ fontWeight: 600 }}>
                      {c.patient_name}
                    </Link>
                    <div className="faint">{patientLine(c)}</div>
                  </td>
                  <td>
                    {c.procedure}
                    {c.laterality !== 'na' && (
                      <span className="faint"> · {LATERALITY_LABEL[c.laterality]}</span>
                    )}
                    <div className="faint">{c.diagnosis}</div>
                    <div className="row tight" style={{ marginTop: 5 }}>
                      <Tag>{ANAESTHESIA_LABEL[c.anaesthesia]}</Tag>
                      <Tag>{formatDuration(c.duration_min)}</Tag>
                      {c.priority !== 'routine' && <Tag tone="warn">{c.priority}</Tag>}
                      {c.is_infected === 1 && <Tag tone="danger">infected</Tag>}
                      {c.is_daycare === 1 && <Tag tone="ok">day care</Tag>}
                    </div>
                  </td>
                  <td>
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
                  </td>
                  <td>
                    {c.workup_total === 0 ? (
                      <span className="faint">No checklist</span>
                    ) : (
                      <>
                        <div className="faint num" style={{ marginBottom: 4 }}>
                          {c.workup_done} / {c.workup_total}
                        </div>
                        <Progress done={c.workup_done} total={c.workup_total} />
                      </>
                    )}
                  </td>
                  <td className="muted">
                    {formatDate(c.scheduled_date)}
                    {!c.scheduled_date && c.target_month && (
                      <div className="faint">target {c.target_month}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adding && (
        <CaseForm
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            void reload();
            navigate(`/cases/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
