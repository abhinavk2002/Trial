import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMutation, useResource, useToast } from '../lib/hooks';
import { Card, ErrorBanner, Field, Toast } from '../components/ui';
import type { Settings as SettingsData } from '../types';

function ListEditor({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div>
      {values.map((value, i) => (
        <div className="row tight" key={`${value}-${i}`} style={{ marginBottom: 6 }}>
          <input
            type="text"
            value={value}
            style={{ flex: 1 }}
            onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="row tight">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          style={{ flex: 1 }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!draft.trim()) return;
            onChange([...values, draft.trim()]);
            setDraft('');
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) return;
            onChange([...values, draft.trim()]);
            setDraft('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { user, refresh } = useAuth();
  const { data, reload } = useResource<SettingsData>('/settings');
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [toast, showToast] = useToast();

  const settingsMutation = useMutation();
  const profileMutation = useMutation();
  const passwordMutation = useMutation();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email);
    }
  }, [user]);

  const feedUrl = user ? `${window.location.origin}/calendar/${user.calendar_token}.ics` : '';

  async function saveSettings() {
    if (!draft) return;
    const done = await settingsMutation.run(() =>
      api.put('/settings', {
        unit_name: draft.unit_name,
        theatres: draft.theatres,
        workup_template: draft.workup_template,
        default_start_time: draft.default_start_time,
        session_am_start: draft.session_am_start,
        session_pm_start: draft.session_pm_start,
        default_turnover_min: Number(draft.default_turnover_min) || 20,
        default_duration_min: Number(draft.default_duration_min) || 60,
      }),
    );
    if (done) {
      showToast('Settings saved');
      void reload();
    }
  }

  async function saveProfile() {
    const done = await profileMutation.run(() => api.patch('/auth/me', { name, email }));
    if (done) {
      showToast('Profile updated');
      void refresh();
    }
  }

  async function changePassword() {
    const done = await passwordMutation.run(() =>
      api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    );
    if (done) {
      showToast('Password changed');
      setCurrentPassword('');
      setNewPassword('');
    }
  }

  async function rotateToken() {
    const ok = window.confirm(
      'Generate a new calendar link? Any calendar already subscribed to the old link will stop updating.',
    );
    if (!ok) return;
    const done = await profileMutation.run(() => api.post('/auth/rotate-calendar-token'));
    if (done) {
      showToast('New calendar link generated');
      void refresh();
    }
  }

  if (!draft) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Theatres, defaults, your account and the calendar feed.</p>
        </div>
      </header>

      <Card
        title="Calendar subscription"
        actions={
          <button className="btn-sm" onClick={() => void rotateToken()}>
            Generate a new link
          </button>
        }
      >
        <p style={{ marginTop: 0 }} className="muted">
          Subscribe to this URL in Google Calendar, Apple Calendar or Outlook and every dated
          case appears in your calendar, updating on its own as the lists change. Anyone with
          the link can read your schedule, so treat it like a password.
        </p>
        <div className="code" style={{ marginBottom: 10 }}>
          {feedUrl}
        </div>
        <div className="row tight">
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(feedUrl);
              showToast('Link copied');
            }}
          >
            Copy link
          </button>
          <a className="btn" href={feedUrl}>
            Download once
          </a>
        </div>
        <p className="hint">
          Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar
          Subscription. Outlook: Add calendar → Subscribe from web.
        </p>
      </Card>

      <div className="grid two">
        <Card title="Your account">
          <ErrorBanner error={profileMutation.error} />
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button
            className="btn-primary"
            disabled={profileMutation.pending}
            onClick={() => void saveProfile()}
          >
            Save profile
          </button>
        </Card>

        <Card title="Change password">
          <ErrorBanner error={passwordMutation.error} />
          <Field label="Current password">
            <input
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <button
            className="btn-primary"
            disabled={passwordMutation.pending || !currentPassword || !newPassword}
            onClick={() => void changePassword()}
          >
            Change password
          </button>
        </Card>
      </div>

      <Card
        title="Theatre defaults"
        actions={
          <button
            className="btn-primary btn-sm"
            disabled={settingsMutation.pending}
            onClick={() => void saveSettings()}
          >
            {settingsMutation.pending ? 'Saving…' : 'Save settings'}
          </button>
        }
      >
        <ErrorBanner error={settingsMutation.error} />

        <Field label="Unit name" hint="Shown as the calendar name in your calendar app.">
          <input
            type="text"
            value={draft.unit_name}
            onChange={(e) => setDraft({ ...draft, unit_name: e.target.value })}
          />
        </Field>

        <Field label="Theatres">
          <ListEditor
            values={draft.theatres}
            placeholder="e.g. OT 3"
            onChange={(theatres) => setDraft({ ...draft, theatres })}
          />
        </Field>

        <div className="field-row">
          <Field label="Morning session starts">
            <input
              type="time"
              value={draft.session_am_start}
              onChange={(e) => setDraft({ ...draft, session_am_start: e.target.value })}
            />
          </Field>
          <Field label="Afternoon session starts">
            <input
              type="time"
              value={draft.session_pm_start}
              onChange={(e) => setDraft({ ...draft, session_pm_start: e.target.value })}
            />
          </Field>
          <Field label="Turnover between cases (min)">
            <input
              type="number"
              min={0}
              max={180}
              step={5}
              value={draft.default_turnover_min}
              onChange={(e) => setDraft({ ...draft, default_turnover_min: e.target.value })}
            />
          </Field>
          <Field label="Default case length (min)">
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={draft.default_duration_min}
              onChange={(e) => setDraft({ ...draft, default_duration_min: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Standard workup checklist"
        actions={
          <button
            className="btn-primary btn-sm"
            disabled={settingsMutation.pending}
            onClick={() => void saveSettings()}
          >
            Save settings
          </button>
        }
      >
        <p style={{ marginTop: 0 }} className="muted">
          Applied to every new case. Individual cases can add or remove steps afterwards.
        </p>
        <ListEditor
          values={draft.workup_template}
          placeholder="e.g. Pulmonary function tests"
          onChange={(workup_template) => setDraft({ ...draft, workup_template })}
        />
      </Card>

      <Toast message={toast} />
    </div>
  );
}
