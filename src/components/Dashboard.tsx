import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkLauncherUpdate, type Update } from '@tauri-apps/plugin-updater';
import { Terminal } from '@xterm/xterm';
import {
  checkShadowsInstall,
  connectMudTerminal,
  createKalismorCharacter,
  detectLocalMinecraftProfile,
  disconnectMudTerminal,
  getKalismorCharacters,
  getLauncherNews,
  openMinecraftLauncher,
  recordShadowsLaunch,
  repairShadowsInstall,
  runWithFreshAethroSession,
  requestKalismorLoginToken,
  sendMudTerminalInput,
  type MudTerminalOutput
} from '../lib/api';
import type {
  AuthSession,
  KalismorCharacter,
  KalismorLoginToken,
  LauncherHome,
  LocalMinecraftProfile,
  ModpackCheckResult,
  ModpackFileStatus,
  NewsFeedId,
  ShadowsRepairProgress
} from '../lib/types';

type Props = {
  session: AuthSession;
  home: LauncherHome;
  onLogout: () => void;
  onSessionUpdated: (session: AuthSession) => void;
};

type LauncherView = 'home' | 'shadows' | 'aethro-online';
type ShadowsInstallState = 'notChecked' | 'checking' | 'needsUpdate' | 'installing' | 'ready' | 'failed';
type LauncherUpdateState = 'idle' | 'checking' | 'available' | 'installing' | 'restarting' | 'failed';
type NewsRefreshState = 'idle' | 'refreshing' | 'failed';
type KalismorClientChoice = 'launcher' | 'external';

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

const AETHRO_ONLINE_STORE_URL = 'https://aethro.online/store';
const AETHRO_ONLINE_FORUMS_URL = 'https://aethro.online/forums';

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

export function Dashboard({ session, home, onLogout, onSessionUpdated }: Props) {
  const launcherAudioRef = useRef<HTMLAudioElement | null>(null);
  const checkedLocalMinecraftProfileRef = useRef(false);
  const refreshedShadowsNewsRef = useRef(false);
  const kalismorTerminalRef = useRef<HTMLDivElement | null>(null);
  const kalismorTerminalInstanceRef = useRef<Terminal | null>(null);
  const kalismorSocketRef = useRef<WebSocket | null>(null);
  const [activeFeed, setActiveFeed] = useState<'all' | NewsFeedId>('all');
  const [view, setView] = useState<LauncherView>('home');
  const [news, setNews] = useState(home.news);
  const [newsRefreshState, setNewsRefreshState] = useState<NewsRefreshState>('idle');
  const [newsRefreshMessage, setNewsRefreshMessage] = useState('');
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
  const [kalismorCharacters, setKalismorCharacters] = useState<KalismorCharacter[]>([]);
  const [kalismorCharactersLoaded, setKalismorCharactersLoaded] = useState(false);
  const [kalismorLoading, setKalismorLoading] = useState(false);
  const [kalismorError, setKalismorError] = useState<string | null>(null);
  const [selectedKalismorCharacterId, setSelectedKalismorCharacterId] = useState('');
  const [newKalismorCharacterName, setNewKalismorCharacterName] = useState('');
  const [creatingKalismorCharacter, setCreatingKalismorCharacter] = useState(false);
  const [kalismorClientChoice, setKalismorClientChoice] = useState<KalismorClientChoice>('launcher');
  const [kalismorLoginToken, setKalismorLoginToken] = useState<KalismorLoginToken | null>(null);
  const [startingKalismor, setStartingKalismor] = useState(false);
  const [kalismorTerminalOpen, setKalismorTerminalOpen] = useState(false);

  async function openExternal(url: string) {
    await openUrl(url);
  }

  async function withFreshSession<T>(action: (activeSession: AuthSession) => Promise<T>): Promise<T> {
    return runWithFreshAethroSession(session, onSessionUpdated, action);
  }

  function routeDeepLink(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    if (parsed.protocol !== 'aethro:') return;

    const target = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
    if (target === 'shadows') {
      setKalismorTerminalOpen(false);
      setView('shadows');
      return;
    }

    if (target === 'kalismor' || target === 'aethro-online') {
      setKalismorTerminalOpen(false);
      setView('aethro-online');
    }
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrent()
      .then((urls) => urls?.forEach(routeDeepLink))
      .catch((err) => console.warn('Unable to read startup deep link.', err));

    onOpenUrl((urls) => urls.forEach(routeDeepLink))
      .then((handler) => {
        unlisten = handler;
      })
      .catch((err) => console.warn('Unable to listen for deep links.', err));

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setNews(home.news);
  }, [home.news]);

  const visibleNews = useMemo(() => {
    if (activeFeed === 'all') return news;
    return news.filter((item) => item.feedId === activeFeed);
  }, [activeFeed, news]);

  const shadowsNews = useMemo(() => news.filter((item) => item.feedId === 'shadows'), [news]);
  const aethroOnlineNews = useMemo(() => news.filter((item) => item.feedId === 'aethro-online'), [news]);
  const selectedKalismorCharacter = useMemo(
    () => kalismorCharacters.find((character) => character.id === selectedKalismorCharacterId) ?? null,
    [kalismorCharacters, selectedKalismorCharacterId]
  );
  const activeTrack = SHADOWS_TRACKS[trackIndex];
  const accountInitial = (home.user.displayName || home.user.username || 'A').slice(0, 1).toUpperCase();

  async function refreshNews() {
    setNewsRefreshState('refreshing');
    setNewsRefreshMessage('');

    try {
      const freshNews = await getLauncherNews();
      const freshShadowsCount = freshNews.filter((item) => item.feedId === 'shadows').length;

      setNews(freshNews);
      setNewsRefreshState('idle');
      setNewsRefreshMessage(`News refreshed. ${freshShadowsCount} Shadows article${freshShadowsCount === 1 ? '' : 's'} loaded.`);
    } catch (err) {
      console.warn('News refresh failed.', err);
      setNewsRefreshState('failed');
      setNewsRefreshMessage(err instanceof Error ? err.message : String(err || 'Unable to refresh news.'));
    }
  }

  useEffect(() => {
    if (view !== 'shadows' || refreshedShadowsNewsRef.current) return;

    refreshedShadowsNewsRef.current = true;
    void refreshNews();
  }, [view]);

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

    if (view !== 'shadows' || !musicEnabled) {
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

  useEffect(() => {
    if (view !== 'aethro-online' || kalismorCharactersLoaded || kalismorLoading) return;
    void loadKalismorCharacters();
  }, [view, kalismorCharactersLoaded, kalismorLoading]);

  useEffect(() => {
    if (!kalismorTerminalOpen || !kalismorTerminalRef.current || !selectedKalismorCharacter || !kalismorLoginToken) return;

    kalismorSocketRef.current?.close();
    kalismorTerminalInstanceRef.current?.dispose();
    let disposed = false;
    let mudSessionId: string | null = null;
    let unlistenMudOutput: (() => void) | undefined;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#050609',
        foreground: '#f2dfad',
        cursor: '#c6ae71',
        selectionBackground: '#3b3442'
      }
    });

    kalismorTerminalInstanceRef.current = terminal;
    terminal.open(kalismorTerminalRef.current);
    terminal.writeln('Aethro Online: Chronicles of Kalismor');
    terminal.writeln(`Character: ${selectedKalismorCharacter.name}`);

    if (kalismorLoginToken.websocketUrl) {
      terminal.writeln('Connecting to Kalismor gateway...');
      const socket = new WebSocket(kalismorLoginToken.websocketUrl);
      kalismorSocketRef.current = socket;

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ token: kalismorLoginToken.token }));
        terminal.writeln('Login token sent.');
      });
      socket.addEventListener('message', (event) => {
        terminal.write(typeof event.data === 'string' ? event.data : String(event.data));
      });
      socket.addEventListener('close', () => {
        terminal.writeln('');
        terminal.writeln('Connection closed.');
      });
      socket.addEventListener('error', () => {
        terminal.writeln('');
        terminal.writeln('Connection error.');
      });
      terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      });
    } else if (kalismorLoginToken.host && kalismorLoginToken.port) {
      terminal.writeln(`Connecting to ${kalismorLoginToken.host}:${kalismorLoginToken.port}...`);

      listen<MudTerminalOutput>('mud-terminal-output', (event) => {
        if (mudSessionId && event.payload.sessionId !== mudSessionId) return;
        terminal.write(event.payload.data);
      })
        .then((cleanup) => {
          if (disposed) {
            cleanup();
          } else {
            unlistenMudOutput = cleanup;
          }
        })
        .catch((err) => {
          terminal.writeln(`Unable to listen for Kalismor terminal output: ${err}`);
        });

      connectMudTerminal(kalismorLoginToken, selectedKalismorCharacter.name)
        .then((sessionId) => {
          if (disposed) {
            void disconnectMudTerminal(sessionId);
            return;
          }
          mudSessionId = sessionId;
          terminal.writeln('Connected. Login token sent.');
        })
        .catch((err) => {
          terminal.writeln(err instanceof Error ? err.message : String(err || 'Unable to connect to Kalismor.'));
        });

      terminal.onData((data) => {
        if (!mudSessionId) return;
        void sendMudTerminalInput(mudSessionId, data === '\r' ? '\r\n' : data).catch((err) => {
          terminal.writeln(err instanceof Error ? err.message : String(err || 'Unable to send terminal input.'));
        });
      });
    } else {
      terminal.writeln('');
      terminal.writeln('Login token issued.');
      terminal.writeln('No terminal host, port, or websocket gateway URL was returned yet.');
      terminal.writeln('');
      terminal.writeln(`Token: ${kalismorLoginToken.token}`);
    }

    return () => {
      disposed = true;
      unlistenMudOutput?.();
      if (mudSessionId) void disconnectMudTerminal(mudSessionId);
      kalismorSocketRef.current?.close();
      kalismorSocketRef.current = null;
      kalismorTerminalInstanceRef.current?.dispose();
      kalismorTerminalInstanceRef.current = null;
    };
  }, [kalismorTerminalOpen, kalismorLoginToken, selectedKalismorCharacter]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.setFullscreen(kalismorTerminalOpen).catch((err) => {
      console.warn('Unable to toggle Kalismor fullscreen mode.', err);
    });

    return () => {
      if (kalismorTerminalOpen) {
        appWindow.setFullscreen(false).catch((err) => {
          console.warn('Unable to leave Kalismor fullscreen mode.', err);
        });
      }
    };
  }, [kalismorTerminalOpen]);

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
      let minecraftProfile: LocalMinecraftProfile = {
        name: home.user.minecraftName || localMinecraftProfile?.name || '',
        uuid: home.user.minecraftUuid || localMinecraftProfile?.uuid,
        source: home.user.minecraftName ? 'Aethro account' : localMinecraftProfile?.source || 'Minecraft Launcher'
      };

      if (!minecraftProfile.name || !minecraftProfile.uuid) {
        const detectedProfile = await detectLocalMinecraftProfile();
        setLocalMinecraftProfile(detectedProfile);

        minecraftProfile = {
          name: home.user.minecraftName || detectedProfile?.name || '',
          uuid: home.user.minecraftUuid || detectedProfile?.uuid,
          source: home.user.minecraftName ? 'Aethro account' : detectedProfile?.source || 'Minecraft Launcher'
        };
      }

      if (!minecraftProfile.name || !minecraftProfile.uuid) {
        throw new Error('Unable to verify your Minecraft username and UUID. Open the Minecraft Launcher once, sign into Java Edition, then try again.');
      }

      await openMinecraftLauncher();
      await withFreshSession((activeSession) => recordShadowsLaunch(activeSession, minecraftProfile));
    } catch (err) {
      setShadowsError(err instanceof Error ? err.message : String(err || 'Unable to open Minecraft Launcher.'));
    } finally {
      setLaunchingMinecraft(false);
    }
  }

  async function loadKalismorCharacters() {
    setKalismorLoading(true);
    setKalismorError(null);

    try {
      const characters = await withFreshSession((activeSession) => getKalismorCharacters(activeSession));
      setKalismorCharacters(characters);
      setKalismorCharactersLoaded(true);
      setSelectedKalismorCharacterId((current) => current || characters[0]?.id || '');
    } catch (err) {
      setKalismorCharacters([]);
      setKalismorCharactersLoaded(true);
      setKalismorError(err instanceof Error ? err.message : String(err || 'Unable to load Kalismor characters.'));
    } finally {
      setKalismorLoading(false);
    }
  }

  async function createKalismorCharacterFromForm() {
    const name = newKalismorCharacterName.trim();
    if (!name) {
      setKalismorError('Enter a character name first.');
      return;
    }

    setCreatingKalismorCharacter(true);
    setKalismorError(null);

    try {
      const character = await withFreshSession((activeSession) => createKalismorCharacter(activeSession, name));
      setKalismorCharacters((characters) => [character, ...characters.filter((item) => item.id !== character.id)]);
      setSelectedKalismorCharacterId(character.id);
      setNewKalismorCharacterName('');
      setKalismorCharactersLoaded(true);
    } catch (err) {
      setKalismorError(err instanceof Error ? err.message : String(err || 'Unable to create Kalismor character.'));
    } finally {
      setCreatingKalismorCharacter(false);
    }
  }

  async function startKalismorLogin() {
    if (!selectedKalismorCharacter) {
      setKalismorError('Select a character first.');
      return;
    }

    setStartingKalismor(true);
    setKalismorError(null);

    try {
      const token = await withFreshSession((activeSession) =>
        requestKalismorLoginToken(activeSession, selectedKalismorCharacter.id)
      );
      setKalismorLoginToken(token);

      if (kalismorClientChoice === 'launcher') {
        setKalismorTerminalOpen(true);
      } else if (token.launchUrl) {
        await openExternal(token.launchUrl);
      }
    } catch (err) {
      setKalismorError(err instanceof Error ? err.message : String(err || 'Unable to start Kalismor login.'));
    } finally {
      setStartingKalismor(false);
    }
  }

  if (view === 'aethro-online') {
    if (kalismorTerminalOpen && selectedKalismorCharacter && kalismorLoginToken) {
      return (
        <main className="dashboard kalismor-page kalismor-terminal-page">
          <header className="topbar kalismor-topbar">
            <div>
              <span className="eyebrow">Chronicles of Kalismor</span>
              <h1>{selectedKalismorCharacter.name}</h1>
            </div>
            <div className="topbar-actions">
              <button className="secondary" onClick={() => setKalismorTerminalOpen(false)}>Exit Terminal</button>
              <button className="secondary" onClick={() => { setKalismorTerminalOpen(false); setView('home'); }}>Back Home</button>
            </div>
          </header>

          <section className="kalismor-terminal-shell">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Live Client</span>
                <h2>Kalismor Terminal</h2>
              </div>
              <span>{kalismorLoginToken.websocketUrl ? 'Gateway ready' : 'Token ready'}</span>
            </div>
            <div ref={kalismorTerminalRef} className="kalismor-terminal" />
          </section>
        </main>
      );
    }

    return (
      <main className="dashboard kalismor-page">
        <header className="topbar kalismor-topbar">
          <div>
            <span className="eyebrow">Aethro Online</span>
            <h1>Chronicles of Kalismor</h1>
          </div>
          <div className="topbar-actions">
            <button className="secondary" onClick={() => setView('home')}>Back</button>
            <button className="secondary" onClick={onLogout}>Log out</button>
          </div>
        </header>

        {renderLauncherUpdateNotice()}

        <section className="kalismor-hero">
          <div className="kalismor-sigil" aria-hidden="true">
            <span />
          </div>
          <div className="kalismor-hero-copy">
            <span className="eyebrow">The Gate Is Stirring</span>
            <h2>Choose a character and open the way into Kalismor.</h2>
            <p>
              Pull your Chronicles roster, create a new name, then choose whether to enter
              through your own MUD client or the launcher terminal.
            </p>
            <div className="kalismor-actions">
              <button className="icon-button" onClick={() => openExternal(AETHRO_ONLINE_STORE_URL)}>
                Store
                <span className="button-icon icon-external" aria-hidden="true" />
              </button>
              <button className="secondary icon-button" onClick={() => openExternal(AETHRO_ONLINE_FORUMS_URL)}>
                Forums
                <span className="button-icon icon-external" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <section className="aethro-online-layout">
          <div className="panel">
            <div className="panel-heading">
              <h2>Characters</h2>
              <span>{home.user.displayName}</span>
            </div>

            <div className="kalismor-panel-actions">
              <button className="secondary compact-button" onClick={loadKalismorCharacters} disabled={kalismorLoading}>
                {kalismorLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {kalismorError && <p className="error">{kalismorError}</p>}

            <div className="kalismor-character-list">
              {kalismorLoading && !kalismorCharactersLoaded ? (
                <div className="identity-box">
                  <span className="eyebrow">Roster</span>
                  <strong>Calling the gate...</strong>
                  <p>Loading your Kalismor characters.</p>
                </div>
              ) : kalismorCharacters.length === 0 ? (
                <div className="identity-box">
                  <span className="eyebrow">Roster</span>
                  <strong>No characters yet</strong>
                  <p>Create your first Chronicles character below.</p>
                </div>
              ) : kalismorCharacters.map((character) => (
                <button
                  key={character.id}
                  className={`kalismor-character-card ${selectedKalismorCharacterId === character.id ? 'active' : ''}`}
                  onClick={() => setSelectedKalismorCharacterId(character.id)}
                >
                  <span className="eyebrow">{character.race || 'Chronicles'}</span>
                  <strong>{character.name}</strong>
                  <span className="kalismor-character-meta">
                    {character.className || 'Adventurer'}
                    {character.level ? ` / Level ${character.level}` : ''}
                    {character.location ? ` / ${character.location}` : ''}
                  </span>
                </button>
              ))}
            </div>

            <form className="kalismor-form" onSubmit={(event) => { event.preventDefault(); void createKalismorCharacterFromForm(); }}>
              <label>
                <span>Create Character</span>
                <input
                  value={newKalismorCharacterName}
                  onChange={(event) => setNewKalismorCharacterName(event.target.value)}
                  placeholder="Character name"
                  autoComplete="off"
                />
              </label>
              <button type="submit" disabled={creatingKalismorCharacter}>
                {creatingKalismorCharacter ? 'Creating...' : 'Create'}
              </button>
            </form>

            <div className="kalismor-login-summary">
              <span className="eyebrow">Login</span>
              <strong>{selectedKalismorCharacter ? selectedKalismorCharacter.name : 'Select a character'}</strong>
              <p>Choose how you want to connect after the launcher requests a fresh character token.</p>

              <div className="kalismor-client-options">
                <button
                  className={`kalismor-client-option ${kalismorClientChoice === 'launcher' ? 'active' : ''}`}
                  onClick={() => setKalismorClientChoice('launcher')}
                  type="button"
                >
                  Launcher Terminal
                </button>
                <button
                  className={`kalismor-client-option ${kalismorClientChoice === 'external' ? 'active' : ''}`}
                  onClick={() => setKalismorClientChoice('external')}
                  type="button"
                >
                  External Client
                </button>
              </div>

              <button onClick={startKalismorLogin} disabled={startingKalismor || !selectedKalismorCharacter}>
                {startingKalismor ? 'Starting...' : 'Start Login'}
              </button>

              {kalismorLoginToken && kalismorClientChoice === 'external' && (
                <div className="kalismor-token-box">
                  <span className="eyebrow">External Client Token</span>
                  <code>{kalismorLoginToken.token}</code>
                  {(kalismorLoginToken.host || kalismorLoginToken.port) && (
                    <p>
                      {kalismorLoginToken.host || 'Server host pending'}
                      {kalismorLoginToken.port ? `:${kalismorLoginToken.port}` : ''}
                    </p>
                  )}
                  {kalismorLoginToken.launchUrl && (
                    <button className="secondary compact-button" onClick={() => openExternal(kalismorLoginToken.launchUrl!)}>
                      Open External Client
                    </button>
                  )}
                </div>
              )}
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
              <div className="news-heading-actions">
                <span>{shadowsNews.length} article{shadowsNews.length === 1 ? '' : 's'}</span>
                <button className="secondary compact-button" onClick={refreshNews} disabled={newsRefreshState === 'refreshing'}>
                  {newsRefreshState === 'refreshing' ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {newsRefreshMessage && (
              <p className={`news-refresh-message ${newsRefreshState === 'failed' ? 'error' : ''}`}>
                {newsRefreshMessage}
              </p>
            )}

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
