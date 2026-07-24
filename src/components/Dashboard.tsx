import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkLauncherUpdate, type Update } from '@tauri-apps/plugin-updater';
import { checkShadowsInstall, detectLocalMinecraftProfile, openMinecraftLauncher, repairShadowsInstall } from '../lib/api';
import type { LauncherHome, LocalMinecraftProfile, ModpackCheckResult, ModpackFileStatus, NewsFeedId, ShadowsRepairProgress } from '../lib/types';

type Props = {
  home: LauncherHome;
  onLogout: () => void;
};

type ShadowsInstallState = 'notChecked' | 'checking' | 'needsUpdate' | 'installing' | 'ready' | 'failed';
type LauncherUpdateState = 'idle' | 'checking' | 'available' | 'installing' | 'restarting' | 'failed';

const FEED_TABS: Array<{ id: 'all' | NewsFeedId; label: string }> = [
  { id: 'all', label: 'All News' },
  { id: 'play-aethro', label: 'Play Aethro' },
  { id: 'aethro-online', label: 'Aethro Online' },
  { id: 'shadows', label: 'Shadows' }
];

const SHADOWS_TRACKS = [
  { title: 'Pale Orchard', src: '/audio/shadows/pale-orchard.mp3' },
  { title: 'Iron Crown Run', src: '/audio/shadows/iron-crown-run.mp3' },
  { title: 'Moss on My Boots', src: '/audio/shadows/moss-on-my-boots.mp3' }
];

const SHADOWS_EVENT = {
  title: 'Sunfire Isles',
  url: 'https://playaethro.online/games/shadows-of-aethro/pages/sunfire-isles'
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso));
}

function fileStatusLabel(status: ModpackFileStatus['status']) {
  switch (status) {
    case 'ok':
      return 'Ready';
    case 'missing':
      return 'Missing';
    case 'changed':
      return 'Changed';
    case 'invalidManifest':
      return 'Manifest issue';
  }
}

function fileStatusClass(status: ModpackFileStatus['status']) {
  if (status === 'ok') return 'online';
  if (status === 'missing') return 'offline';
  return 'maintenance';
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function installStateLabel(state: ShadowsInstallState) {
  switch (state) {
    case 'notChecked':
      return 'Not checked';
    case 'checking':
      return 'Checking';
    case 'needsUpdate':
      return 'Needs update';
    case 'installing':
      return 'Installing';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

function worldCardClass(gameId: string) {
  if (gameId === 'shadows') return 'world-card shadows-world-card';
  if (gameId === 'aethro-online') return 'world-card kalismor-world-card';
  return 'world-card';
}

export function Dashboard({ home, onLogout }: Props) {
  const launcherAudioRef = useRef<HTMLAudioElement | null>(null);
  const checkedLocalMinecraftProfileRef = useRef(false);
  const [activeFeed, setActiveFeed] = useState<'all' | NewsFeedId>('all');
  const [view, setView] = useState<'home' | 'shadows' | 'aethro-online'>('home');
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(42);
  const [trackIndex, setTrackIndex] = useState(0);
  const [modpackCheck, setModpackCheck] = useState<ModpackCheckResult | null>(null);
  const [installState, setInstallState] = useState<ShadowsInstallState>('notChecked');
  const [repairProgress, setRepairProgress] = useState<ShadowsRepairProgress | null>(null);
  const [localMinecraftProfile, setLocalMinecraftProfile] = useState<LocalMinecraftProfile | null>(null);
  const [checkingMinecraftProfile, setCheckingMinecraftProfile] = useState(false);
  const [checkingFiles, setCheckingFiles] = useState(false);
  const [repairingFiles, setRepairingFiles] = useState(false);
  const [launchingMinecraft, setLaunchingMinecraft] = useState(false);
  const [shadowsError, setShadowsError] = useState<string | null>(null);
  const [launcherUpdate, setLauncherUpdate] = useState<Update | null>(null);
  const [launcherUpdateState, setLauncherUpdateState] = useState<LauncherUpdateState>('idle');
  const [launcherUpdateMessage, setLauncherUpdateMessage] = useState('');
  const [launcherUpdateProgress, setLauncherUpdateProgress] = useState(0);

  async function openExternal(url: string) {
    await openUrl(url);
  }

  function playGame(gameId: string) {
    if (gameId === 'shadows') {
      setView('shadows');
      return;
    }

    if (gameId === 'aethro-online') {
      setView('aethro-online');
      return;
    }

    alert(`${gameId} launcher flow not wired yet.`);
  }

  const visibleNews = useMemo(() => {
    if (activeFeed === 'all') return home.news;
    return home.news.filter((item) => item.feedId === activeFeed);
  }, [activeFeed, home.news]);

  const shadowsNews = useMemo(() => home.news.filter((item) => item.feedId === 'shadows'), [home.news]);
  const aethroOnlineNews = useMemo(() => home.news.filter((item) => item.feedId === 'aethro-online'), [home.news]);
  const activeTrack = SHADOWS_TRACKS[trackIndex];
  const accountInitial = (home.user.displayName || home.user.username || 'A').slice(0, 1).toUpperCase();

  async function checkForLauncherUpdate(showErrors = false) {
    setLauncherUpdateState('checking');

    try {
      const update = await checkLauncherUpdate({ timeout: 8_000 });
      if (!update) {
        setLauncherUpdate(null);
        setLauncherUpdateState('idle');
        setLauncherUpdateMessage('');
        return;
      }

      setLauncherUpdate(update);
      setLauncherUpdateState('available');
      setLauncherUpdateMessage(`Version ${update.version} is ready to install.`);
      setLauncherUpdateProgress(0);
    } catch (err) {
      console.warn('Launcher update check failed.', err);
      setLauncherUpdate(null);
      setLauncherUpdateState(showErrors ? 'failed' : 'idle');
      setLauncherUpdateMessage(
        showErrors
          ? err instanceof Error ? err.message : String(err || 'Unable to check for launcher updates.')
          : ''
      );
    }
  }

  async function installLauncherUpdate() {
    if (!launcherUpdate) return;

    setLauncherUpdateState('installing');
    setLauncherUpdateMessage(`Installing version ${launcherUpdate.version}...`);
    setLauncherUpdateProgress(0);

    let downloadedBytes = 0;
    let totalBytes = 0;

    try {
      await launcherUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          downloadedBytes = 0;
          totalBytes = event.data.contentLength ?? 0;
          setLauncherUpdateProgress(0);
        }

        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setLauncherUpdateProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          }
        }

        if (event.event === 'Finished') {
          setLauncherUpdateProgress(100);
        }
      });

      setLauncherUpdateState('restarting');
      setLauncherUpdateMessage('Update installed. Restarting the launcher...');
      await relaunch();
    } catch (err) {
      console.error('Launcher update install failed.', err);
      setLauncherUpdateState('failed');
      setLauncherUpdateMessage(err instanceof Error ? err.message : String(err || 'Unable to install launcher update.'));
    }
  }

  function renderLauncherUpdateNotice() {
    if (launcherUpdateState === 'idle' || launcherUpdateState === 'checking') return null;

    return (
      <section className={`launcher-update launcher-update-${launcherUpdateState}`}>
        <div>
          <span className="eyebrow">Launcher Update</span>
          <strong>
            {launcherUpdateState === 'available'
              ? 'Update available'
              : launcherUpdateState === 'installing'
                ? 'Installing update'
                : launcherUpdateState === 'restarting'
                  ? 'Restarting'
                  : 'Update check failed'}
          </strong>
          <p>{launcherUpdateMessage}</p>
          {(launcherUpdateState === 'installing' || launcherUpdateState === 'restarting') && (
            <div className="launcher-update-progress" aria-label="Launcher update progress">
              <span style={{ width: `${launcherUpdateProgress}%` }} />
            </div>
          )}
        </div>
        {launcherUpdateState === 'available' && (
          <button className="icon-button" onClick={installLauncherUpdate}>
            <span className="button-icon icon-download" aria-hidden="true" />
            Install Update
          </button>
        )}
        {launcherUpdateState === 'failed' && (
          <button className="secondary" onClick={() => checkForLauncherUpdate(true)}>
            Retry
          </button>
        )}
      </section>
    );
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;

    try {
      listen<ShadowsRepairProgress>('shadows-repair-progress', (event) => {
        const progress = event.payload;
        setRepairProgress(progress);

        if (progress.phase === 'checking' || progress.phase === 'verifying') {
          setInstallState('checking');
        } else if (progress.phase === 'installing' || progress.phase === 'setup') {
          setInstallState('installing');
        } else if (progress.phase === 'ready') {
          setInstallState('ready');
        } else if (progress.phase === 'needsUpdate') {
          setInstallState('needsUpdate');
        } else if (progress.phase === 'failed') {
          setInstallState('failed');
        }
      })
        .then((cleanup) => {
          if (mounted) unlisten = cleanup;
        })
        .catch((err) => {
          console.warn('Shadows progress listener unavailable.', err);
        });
    } catch (err) {
      console.warn('Shadows progress listener unavailable.', err);
    }

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    checkForLauncherUpdate();
  }, []);

  useEffect(() => {
    const audio = launcherAudioRef.current;
    if (!audio) return;

    if ((view !== 'shadows' && view !== 'aethro-online') || !musicEnabled) {
      audio.pause();
      return;
    }

    audio.volume = musicVolume / 100;
    audio.play().catch(() => {
      setMusicEnabled(false);
    });
  }, [musicEnabled, musicVolume, trackIndex, view]);

  useEffect(() => {
    if (view === 'shadows') return;
    checkedLocalMinecraftProfileRef.current = false;
    setCheckingMinecraftProfile(false);
  }, [view]);

  useEffect(() => {
    if (view !== 'shadows' || home.user.minecraftName || localMinecraftProfile || checkedLocalMinecraftProfileRef.current) return;

    checkedLocalMinecraftProfileRef.current = true;
    setCheckingMinecraftProfile(true);
    detectLocalMinecraftProfile()
      .then((profile) => {
        setLocalMinecraftProfile(profile);
      })
      .catch(() => {
        setLocalMinecraftProfile(null);
      })
      .finally(() => {
        setCheckingMinecraftProfile(false);
      });
  }, [home.user.minecraftName, localMinecraftProfile, view]);

  function toggleMusic() {
    setMusicEnabled((enabled) => !enabled);
  }

  function updateMusicVolume(value: string) {
    setMusicVolume(Number(value));
  }

  function playNextTrack() {
    setTrackIndex((index) => (index + 1) % SHADOWS_TRACKS.length);
  }

  async function verifyShadowsFiles() {
    setCheckingFiles(true);
    setInstallState('checking');
    setRepairProgress(null);
    setShadowsError(null);

    try {
      const result = await checkShadowsInstall();
      setModpackCheck(result);
      setInstallState(result.ready ? 'ready' : 'needsUpdate');
    } catch (err) {
      setInstallState('failed');
      setShadowsError(err instanceof Error ? err.message : String(err || 'Unable to verify Shadows files.'));
    } finally {
      setCheckingFiles(false);
    }
  }

  async function repairShadowsFiles() {
    setRepairingFiles(true);
    setInstallState('checking');
    setRepairProgress(null);
    setShadowsError(null);

    try {
      const result = await repairShadowsInstall();
      setModpackCheck(result);
      setInstallState(result.ready ? 'ready' : 'needsUpdate');
    } catch (err) {
      setInstallState('failed');
      setShadowsError(err instanceof Error ? err.message : String(err || 'Unable to install Shadows files.'));
    } finally {
      setRepairingFiles(false);
    }
  }

  async function launchMinecraftLauncher() {
    setLaunchingMinecraft(true);
    setShadowsError(null);

    try {
      await openMinecraftLauncher();
    } catch (err) {
      setShadowsError(err instanceof Error ? err.message : String(err || 'Unable to open Minecraft Launcher.'));
    } finally {
      setLaunchingMinecraft(false);
    }
  }

  if (view === 'aethro-online') {
    return (
      <main className="dashboard kalismor-page">
        <header className="topbar kalismor-topbar">
          <div>
            <span className="eyebrow">Aethro Online</span>
            <h1>Chronicles of Kalismor</h1>
          </div>
          <div className="topbar-actions">
            <div className="music-control kalismor-music-control">
              <button
                className={`secondary music-toggle ${musicEnabled ? 'active' : ''}`}
                onClick={toggleMusic}
                aria-pressed={musicEnabled}
              >
                {musicEnabled ? 'Music On' : 'Music Off'}
              </button>
              <label>
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={musicVolume}
                  onChange={(event) => updateMusicVolume(event.target.value)}
                  aria-label="Music volume"
                />
              </label>
            </div>
            <button className="secondary" onClick={() => setView('home')}>Back</button>
            <button className="secondary" onClick={onLogout}>Log out</button>
          </div>
        </header>

        {renderLauncherUpdateNotice()}

        <audio ref={launcherAudioRef} src={activeTrack.src} onEnded={playNextTrack} preload="auto" />

        <section className="kalismor-hero">
          <div className="kalismor-sigil" aria-hidden="true">
            <span />
          </div>
          <div className="kalismor-hero-copy">
            <span className="eyebrow">The Gate Is Sealed</span>
            <h2>Kalismor waits beneath a black sky.</h2>
            <p>
              Character binding, terminal launch, and live realm access are being prepared.
              For now, this page will carry Chronicles news and the shape of what is coming.
            </p>
            <button className="secondary coming-soon-button" disabled>
              Coming Soon
            </button>
          </div>
        </section>

        <section className="aethro-online-layout">
          <div className="panel">
            <div className="panel-heading">
              <h2>Account</h2>
              <span>{home.user.displayName}</span>
            </div>

            <div className="identity-box">
              <span className="eyebrow">Character</span>
              <strong>Not selected yet</strong>
              <p>Chronicles character selection will appear here once the Kalismor account bridge is ready.</p>
            </div>

            <div className="music-now-playing">
              <span className="eyebrow">Now Playing</span>
              <strong>{activeTrack.title}</strong>
            </div>

            <div className="patch-actions">
              <button disabled>
                Coming Soon
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Aethro Online News</h2>
              <span>{aethroOnlineNews.length} article{aethroOnlineNews.length === 1 ? '' : 's'}</span>
            </div>

            <div className="news-list">
              {aethroOnlineNews.length === 0 ? (
                <article className="news-item">
                  <h3>No Aethro Online news loaded</h3>
                  <p>The Aethro Online RSS feed did not return articles yet.</p>
                </article>
              ) : aethroOnlineNews.map((item) => (
                <article key={item.id} className="news-item">
                  <div className="news-meta">
                    <span>{item.feedName}</span>
                    <span>{formatDate(item.publishedAt)}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  <button className="link-button" onClick={() => openExternal(item.url)}>Read more</button>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (view === 'shadows') {
    const minecraftName = home.user.minecraftName || localMinecraftProfile?.name;
    const minecraftNameSource = home.user.minecraftName ? 'Aethro account' : localMinecraftProfile?.source;
    const ready = modpackCheck?.ready ?? false;
    const progressPercent = repairProgress?.totalBytes
      ? Math.min(100, Math.round((repairProgress.downloadedBytes / repairProgress.totalBytes) * 100))
      : installState === 'ready'
        ? 100
        : modpackCheck?.totalFiles
          ? Math.round((modpackCheck.okFiles / modpackCheck.totalFiles) * 100)
          : 0;
    const progressDetail = repairProgress?.totalFiles
      ? `${repairProgress.currentIndex}/${repairProgress.totalFiles} files`
      : modpackCheck
        ? `${modpackCheck.okFiles}/${modpackCheck.totalFiles} files verified`
        : installState === 'checking'
          ? 'Starting scan'
          : installState === 'installing'
            ? 'Preparing install'
            : 'No scan yet';
    const statusMessage = repairProgress?.message
      || (modpackCheck ? modpackCheck.installDir : installState === 'notChecked'
        ? 'Run install or verify before opening Minecraft.'
        : 'Preparing Shadows status.');

    return (
      <main className="dashboard shadows-page">
        <header className="topbar">
          <div>
            <span className="eyebrow">Shadows of Aethro</span>
            <h1>Expedition Ready</h1>
          </div>
          <div className="topbar-actions">
            <div className="music-control">
              <div className="topbar-now-playing">
                <span>Now Playing</span>
                <strong>{activeTrack.title}</strong>
              </div>
              <label>
                <span>Volume</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={musicVolume}
                  onChange={(event) => updateMusicVolume(event.target.value)}
                  aria-label="Music volume"
                />
              </label>
            </div>
            <button
              className={`secondary music-toggle ${musicEnabled ? 'active' : ''}`}
              onClick={toggleMusic}
              aria-pressed={musicEnabled}
            >
              {musicEnabled ? 'Music On' : 'Music Off'}
            </button>
            <button className="secondary" onClick={() => setView('home')}>Back</button>
            <button className="secondary" onClick={onLogout}>Log out</button>
          </div>
        </header>

        {renderLauncherUpdateNotice()}

        <audio ref={launcherAudioRef} src={activeTrack.src} onEnded={playNextTrack} preload="auto" />

        <section className="shadows-adventure-banner">
          <div className="shadows-landscape" aria-hidden="true">
            <span className="pixel-sun" />
            <span className="pixel-cloud cloud-one" />
            <span className="pixel-cloud cloud-two" />
            <span className="capture-capsule" />
            <span className="village-hut" />
            <div className="block-ridge ridge-back" />
            <div className="block-ridge ridge-front" />
          </div>
          <div className="shadows-banner-copy">
            <span className="eyebrow">Shadows Client</span>
            <h2>Install, verify, and launch Shadows of Aethro.</h2>
          </div>
        </section>

        <section className="shadows-layout">
          <div className="panel">
            <div className="panel-heading">
              <h2>Account</h2>
              <span>{home.user.displayName}</span>
            </div>

            <div className="identity-box">
              <span className="eyebrow">Minecraft Name</span>
              <strong>{minecraftName || (checkingMinecraftProfile ? 'Checking local launcher...' : 'Not linked yet')}</strong>
              <p>
                {minecraftName
                  ? `Found from ${minecraftNameSource}.`
                  : 'Aethro did not return a Minecraft name, and the local Minecraft Launcher profile was not found yet.'}
              </p>
            </div>

            <div className="current-event-box">
              <span className="eyebrow">Current Event</span>
              <strong>{SHADOWS_EVENT.title}</strong>
              <button className="link-button icon-button" onClick={() => openExternal(SHADOWS_EVENT.url)}>
                Event Details
                <span className="button-icon icon-external" aria-hidden="true" />
              </button>
            </div>

            <div className={`install-status install-status-${installState}`}>
              <div className="install-status-heading">
                <div>
                  <span className="eyebrow">Install Status</span>
                  <strong>{installStateLabel(installState)}</strong>
                </div>
                <span>{progressDetail}</span>
              </div>

              <div className="progress-track" aria-label="Shadows install progress">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="install-status-detail">
                <span>{statusMessage}</span>
                {repairProgress?.totalBytes ? (
                  <span>{formatBytes(repairProgress.downloadedBytes)} / {formatBytes(repairProgress.totalBytes)}</span>
                ) : null}
              </div>

              {repairProgress?.currentFile ? <p>{repairProgress.currentFile}</p> : null}
            </div>

            <div className="patch-actions">
              <button onClick={repairShadowsFiles} disabled={repairingFiles || checkingFiles}>
                {repairingFiles ? 'Installing...' : 'Install / Repair Shadows'}
              </button>
              <button className="secondary" onClick={verifyShadowsFiles} disabled={checkingFiles || repairingFiles}>
                {checkingFiles ? 'Checking...' : 'Verify'}
              </button>
              <button className="secondary" onClick={launchMinecraftLauncher} disabled={launchingMinecraft || repairingFiles || !ready}>
                {launchingMinecraft ? 'Opening...' : 'Open Minecraft Launcher'}
              </button>
            </div>

            {shadowsError && <p className="error">{shadowsError}</p>}

            {modpackCheck && (
              <div className="patch-summary">
                <div>
                  <strong>{modpackCheck.ready ? 'Ready' : 'Needs files'}</strong>
                  <span>{modpackCheck.okFiles}/{modpackCheck.totalFiles} files verified</span>
                </div>
                <p>{modpackCheck.installDir}</p>
                <div className="patch-counts">
                  <span>{modpackCheck.missingFiles} missing</span>
                  <span>{modpackCheck.changedFiles} changed</span>
                  <span>{modpackCheck.invalidManifestFiles} manifest issues</span>
                </div>
              </div>
            )}

            {modpackCheck && modpackCheck.files.length > 0 && (
              <div className="file-list">
                {modpackCheck.files.slice(0, 8).map((file) => (
                  <div key={file.path} className="file-row">
                    <span>{file.path}</span>
                    <strong className={`status ${fileStatusClass(file.status)}`}>
                      {fileStatusLabel(file.status)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <h2>Shadows News</h2>
              <span>{shadowsNews.length} article{shadowsNews.length === 1 ? '' : 's'}</span>
            </div>

            <div className="news-list">
              {shadowsNews.length === 0 ? (
                <article className="news-item">
                  <h3>No Shadows news loaded</h3>
                  <p>The Shadows RSS feed did not return articles yet.</p>
                </article>
              ) : shadowsNews.map((item) => (
                <article key={item.id} className="news-item">
                  <div className="news-meta">
                    <span>{item.feedName}</span>
                    <span>{formatDate(item.publishedAt)}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  <button className="link-button" onClick={() => openExternal(item.url)}>Read more</button>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard home-dashboard">
      <header className="home-topbar">
        <div className="home-brand">
          <div className="home-brand-mark">PA</div>
          <div>
            <span className="eyebrow">Play Aethro Launcher</span>
            <h1>Welcome back, {home.user.displayName}</h1>
          </div>
        </div>
        <div className="home-actions">
          <button className="secondary icon-button" onClick={() => openExternal(home.links.website)}>
            <span className="button-icon icon-globe" aria-hidden="true" />
            Website
          </button>
          <button className="secondary icon-button" onClick={() => openExternal(home.links.discord)}>
            <span className="button-icon icon-chat" aria-hidden="true" />
            Discord
          </button>
          <button className="secondary icon-button" onClick={onLogout}>
            <span className="button-icon icon-exit" aria-hidden="true" />
            Log out
          </button>
        </div>
      </header>

      {renderLauncherUpdateNotice()}

      <section className="home-hero">
        <img src="/images/play-aethro-hero.png" alt="" />
        <div className="home-hero-copy">
          <span className="eyebrow">Gateway Open</span>
          <h2>Choose your world</h2>
          <p>Launch Shadows, step into Kalismor, or catch up on the latest Aethro updates.</p>
          <div className="home-hero-actions">
            <button className="icon-button" onClick={() => playGame('shadows')}>
              <span className="button-icon icon-play" aria-hidden="true" />
              Play Shadows
            </button>
            <button className="secondary icon-button" onClick={() => playGame('aethro-online')}>
              <span className="button-icon icon-star" aria-hidden="true" />
              Kalismor
            </button>
          </div>
        </div>
        <div className="home-account-card">
          <div className="home-avatar">{accountInitial}</div>
          <div>
            <span className="eyebrow">Signed In</span>
            <strong>{home.user.displayName}</strong>
          </div>
        </div>
      </section>

      <section className="home-layout">
        <div className="worlds-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">World Select</span>
              <h2>Play</h2>
            </div>
            <span>{home.games.length} worlds</span>
          </div>

          <div className="world-grid">
            {home.games.map((game) => (
              <article key={game.id} className={worldCardClass(game.id)}>
                <div className="world-card-art" aria-hidden="true">
                  <span />
                </div>
                <div className="world-card-content">
                  <div className="world-card-title">
                    <div>
                      <span className="eyebrow">{game.id === 'aethro-online' ? 'Chronicles' : 'Adventure'}</span>
                      <h3>{game.title}</h3>
                    </div>
                    <span className={`status ${game.status}`}>{game.status}</span>
                  </div>
                  <p>{game.description}</p>
                  <button className="icon-button" onClick={() => playGame(game.id)}>
                    <span className="button-icon icon-play" aria-hidden="true" />
                    {game.actionLabel}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="home-news-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Aethro Wire</span>
              <h2>News</h2>
            </div>
            <span>{visibleNews.length} article{visibleNews.length === 1 ? '' : 's'}</span>
          </div>

          <div className="feed-tabs home-feed-tabs">
            {FEED_TABS.map((feed) => (
              <button
                key={feed.id}
                className={activeFeed === feed.id ? 'active' : ''}
                onClick={() => setActiveFeed(feed.id)}
              >
                {feed.label}
              </button>
            ))}
          </div>

          <div className="news-list home-news-list">
            {visibleNews.length === 0 ? (
              <article className="news-item">
                <h3>No news loaded</h3>
                <p>The RSS feed did not return articles yet.</p>
              </article>
            ) : visibleNews.slice(0, 4).map((item) => (
              <article key={item.id} className="news-item">
                <div className="news-meta">
                  <span>{item.feedName}</span>
                  <span>{formatDate(item.publishedAt)}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <button className="link-button icon-button" onClick={() => openExternal(item.url)}>
                  Read more
                  <span className="button-icon icon-external" aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
