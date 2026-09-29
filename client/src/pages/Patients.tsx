import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { qs } from '../lib/api';
import { useDebounced, useResource } from '../lib/hooks';
import { Card, Empty, Tag } from '../components/ui';
import PatientForm from '../components/PatientForm';
import { SEX_LABEL } from '../lib/format';
import type { PatientSummary } from '../types';

export default function Patients() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  const { data, loading, reload } = useResource<PatientSummary[]>(
    `/patients${qs({ search: debounced })}`,
  );

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Patients</h1>
          <p className="page-sub">Everyone under your care, and their surgical history.</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          New patient
        </button>
      </header>

      <Card
        title={
          <input
            type="search"
            value={search}
            placeholder="Search by name, hospital number or phone…"
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 380 }}
          />
        }
        actions={<span className="faint">{data?.length ?? 0} patients</span>}
        tight
      >
        {loading && !data ? (
          <Empty>Loading…</Empty>
        ) : !data || data.length === 0 ? (
          <Empty>
            {debounced ? 'No patients match that search.' : 'No patients yet — add the first one.'}
          </Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 130 }}>Hospital no.</th>
                <th style={{ width: 90 }}>Age / sex</th>
                <th>Comorbidities</th>
                <th style={{ width: 130 }}>Phone</th>
                <th style={{ width: 110 }}>Cases</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/patients/${p.id}`} style={{ fontWeight: 600 }}>
                      {p.name}
                    </Link>
                    {p.allergies && (
                      <div>
                        <Tag tone="danger">Allergy: {p.allergies}</Tag>
                      </div>
                    )}
                  </td>
                  <td className="num muted">{p.mrn ?? '—'}</td>
                  <td className="num muted">
                    {p.age !== null ? `${p.age} y` : '—'}
                    {p.sex !== 'unknown' ? ` · ${SEX_LABEL[p.sex]}` : ''}
                  </td>
                  <td className="muted">{p.comorbidities ?? '—'}</td>
                  <td className="num muted">{p.phone ?? '—'}</td>
                  <td>
                    {p.active_case_count > 0 ? (
                      <Tag tone="accent">{p.active_case_count} active</Tag>
                    ) : (
                      <span className="faint">{p.case_count} total</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adding && (
        <PatientForm
          onClose={() => setAdding(false)}
          onSaved={(p) => {
            setAdding(false);
            void reload();
            navigate(`/patients/${p.id}`);
          }}
        />
      )}
    </div>
  );
}
