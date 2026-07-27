import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Dashboard } from './components/Dashboard';
import { LoginScreen } from './components/LoginScreen';
import {
  clearSavedSession,
  createLauncherHome,
  getLauncherHome,
  isAuthRejection,
  loadSavedSession,
  logoutSession,
  refreshAethroSession,
  refreshSession
} from './lib/api';
import type { AuthSession, LauncherHome } from './lib/types';

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadSavedSession());
  const [home, setHome] = useState<LauncherHome | null>(() => session?.user ? createLauncherHome(session.user) : null);
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(import.meta.env.VITE_APP_VERSION));
  }, []);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    const currentSession = session;
    if (currentSession.user) {
      setHome((currentHome) => createLauncherHome(currentSession.user!, currentHome?.news ?? []));
    }

    setLoading(!currentSession.user);
    setBootError(null);

    async function boot() {
      let activeSession = await refreshSession(currentSession);
      if (!activeSession) {
        clearSavedSession();
        if (!cancelled) {
          setSession(null);
          setHome(null);
        }
        return;
      }

      let launcherHome: LauncherHome;
      try {
        launcherHome = await getLauncherHome(activeSession);
      } catch (err) {
        if (!isAuthRejection(err)) throw err;

        const refreshedSession = await refreshAethroSession(activeSession);
        if (!refreshedSession) throw err;

        activeSession = refreshedSession;
        launcherHome = await getLauncherHome(activeSession);
      }

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

  const versionBadge = appVersion ? <div className="app-version-badge">v{appVersion}</div> : null;

  if (!session) {
    return (
      <>
        {versionBadge}
        <LoginScreen onLoggedIn={setSession} />
      </>
    );
  }

  if (!home) {
    return (
      <>
        {versionBadge}
        <main className="loading brand-loading">
          <div className="loading-scene">
            <img src="/images/play-aethro-hero.png" alt="" />
            <div className="loading-orb">PA</div>
          </div>
          <div className="loading-copy">
            <span className="eyebrow">Play Aethro Launcher</span>
            <h1>Opening the gateway</h1>
            <div className="loading-bar"><span /></div>
            {bootError && <p className="error">{bootError}</p>}
            {bootError && <button onClick={logout}>Back to login</button>}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {versionBadge}
      <Dashboard session={session} home={home} onLogout={logout} onSessionUpdated={setSession} />
    </>
  );
}
