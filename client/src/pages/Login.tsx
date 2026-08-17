import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ErrorBanner, Field } from '../components/ui';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-shell">
      <form className="card auth-card" onSubmit={(e) => void onSubmit(e)}>
        <div className="brand" style={{ padding: '0 0 20px' }}>
          <div className="brand-mark">OT</div>
          <div>
            <div className="brand-name">OT Manager</div>
            <div className="brand-sub">Theatre lists and patient scheduling</div>
          </div>
        </div>

        <ErrorBanner error={error} />

        <Field label="Email">
          <input
            type="email"
            value={email}
            autoComplete="username"
            autoFocus
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <button
          type="submit"
          className="btn-primary"
          disabled={pending}
          style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
