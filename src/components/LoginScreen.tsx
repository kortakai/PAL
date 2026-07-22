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
    <main className="login-shell brand-login">
      <section className="hero-card brand-hero">
        <img className="brand-hero-image" src="/images/play-aethro-hero.png" alt="" />
        <div className="brand-mark">
          <span>PA</span>
        </div>
        <div className="hero-copy brand-hero-copy">
          <span className="eyebrow">Play Aethro Launcher</span>
          <h1>Choose Your World</h1>
          <p>Shadows of Aethro, Chronicles of Kalismor, and the next gate beyond.</p>
          <div className="brand-worlds">
            <span>Shadows</span>
            <span>Kalismor</span>
            <span>Aethro.net</span>
          </div>
        </div>
      </section>

      <section className="login-card brand-login-card">
        <div className="login-card-mark">
          <span>Gateway</span>
        </div>
        <h2>Enter Aethro</h2>
        <p className="muted">Use your Aethro account to sync launcher access across worlds.</p>

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
      </section>
    </main>
  );
}
