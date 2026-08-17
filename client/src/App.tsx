import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useResource } from './lib/hooks';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';
import Cases from './pages/Cases';
import CaseDetail from './pages/CaseDetail';
import Schedule from './pages/Schedule';
import OtLists from './pages/OtLists';
import Settings from './pages/Settings';
import type { Dashboard as DashboardData } from './types';

function Sidebar() {
  const { user, signOut } = useAuth();
  // Cheap counts for the nav badges; the dashboard endpoint already has them.
  const { data } = useResource<DashboardData>('/dashboard');

  const todaysCases = data?.todays_lists.reduce((n, l) => n + l.entries.length, 0) ?? 0;
  const toDate = data?.ready_to_date.length ?? 0;
  const toConfirm = data?.awaiting_confirmation.length ?? 0;

  return (
    <nav className="sidebar no-print">
      <div className="brand">
        <div className="brand-mark">OT</div>
        <div>
          <div className="brand-name">OT Manager</div>
          <div className="brand-sub">{user?.name}</div>
        </div>
      </div>

      <NavLink to="/" end className="nav-link">
        Dashboard
        {todaysCases > 0 && <span className="nav-count">{todaysCases}</span>}
      </NavLink>
      <NavLink to="/patients" className="nav-link">
        Patients
      </NavLink>
      <NavLink to="/cases" className="nav-link">
        Cases
        {toDate > 0 && <span className="nav-count">{toDate}</span>}
      </NavLink>
      <NavLink to="/schedule" className="nav-link">
        Scheduling
        {toConfirm > 0 && <span className="nav-count">{toConfirm}</span>}
      </NavLink>
      <NavLink to="/ot-lists" className="nav-link">
        OT lists
      </NavLink>
      <NavLink to="/settings" className="nav-link">
        Settings
      </NavLink>

      <div className="sidebar-foot">
        <button className="btn-ghost btn-sm" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientDetail />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/ot-lists" element={<OtLists />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
