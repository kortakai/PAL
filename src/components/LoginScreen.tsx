import { useState } from 'react';
import { beginDiscordLogin, loginWithAethro } from '../lib/api';
import type { AuthSession } from '../lib/types';

type Props = {
  onLoggedIn: (session: AuthSession) => void;
};

export function LoginScreen({ onLoggedIn }: Props) {
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aethroLogin() {
    setBusy(true);
    setError(null);

    try {
      const session = await loginWithAethro(remember);
      onLoggedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || 'Login failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function discordLogin() {
    setDiscordBusy(true);
    setError(null);

    try {
      const session = await beginDiscordLogin(remember);
      onLoggedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err || 'Unable to start Discord login.'));
    } finally {
      setDiscordBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="hero-card">
        <div className="hero-art">PLAY AETHRO</div>
        <div className="hero-copy">
          <h1>Play Aethro</h1>
          <p>Shadows of Aethro, Aethro Online, and whatever chaos comes next.</p>
        </div>
      </section>

      <section className="login-card">
        <h2>Log in</h2>
        <p className="muted">
          Use your existing Aethro account system. The launcher opens Aethro in your browser and comes back here after login.
        </p>

        <div className="login-actions">
          <button type="button" onClick={aethroLogin} disabled={busy || discordBusy}>
            {busy ? 'Waiting for Aethro…' : 'Log in with Aethro'}
          </button>

          <button className="secondary" type="button" onClick={discordLogin} disabled={busy || discordBusy}>
            {discordBusy ? 'Waiting for Discord…' : 'Log in with Discord'}
          </button>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this device
        </label>

        {error && <p className="error">{error}</p>}

        <p className="muted tiny">
          Dev callback: <code>http://127.0.0.1:38987/oauth/callback</code>
        </p>
      </section>
    </main>
  );
}
