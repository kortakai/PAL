import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { LoginScreen } from './components/LoginScreen';
import { clearSavedSession, getLauncherHome, loadSavedSession, logoutSession, refreshSession } from './lib/api';
import type { AuthSession, LauncherHome } from './lib/types';

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSavedSession());
  const [home, setHome] = useState<LauncherHome | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const currentSession = session;
    setLoading(true);
    setBootError(null);

    async function boot() {
      const activeSession = await refreshSession(currentSession);
      if (!activeSession) {
        clearSavedSession();
        if (!cancelled) {
          setSession(null);
          setHome(null);
        }
        return;
      }

      const launcherHome = await getLauncherHome(activeSession);
      if (!cancelled) {
        setSession(activeSession);
        setHome(launcherHome);
      }
    }

    boot()
      .catch((err) => {
        console.error(err);
        if (!cancelled) setBootError(err instanceof Error ? err.message : 'Unable to start launcher.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  async function logout() {
    if (session) await logoutSession(session);
    setSession(null);
    setHome(null);
  }

  if (!session) return <LoginScreen onLoggedIn={setSession} />;

  if (loading || !home) {
    return (
      <main className="loading">
        <div>
          <h1>Loading Play Aethro…</h1>
          {bootError && <p className="error">{bootError}</p>}
          {bootError && <button onClick={logout}>Back to login</button>}
        </div>
      </main>
    );
  }

  return <Dashboard home={home} onLogout={logout} />;
}
