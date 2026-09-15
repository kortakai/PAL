import { GameHub } from './GameHub';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkLauncherUpdate, type Update } from '@tauri-apps/plugin-updater';
import { Terminal } from '@xterm/xterm';
import {
  checkReforgedInstall,
  checkReforgedManifestUpdate,
  checkShadowsInstall,
  connectMudTerminal,
  createKalismorCharacter,
  detectLocalMinecraftProfile,
  detectLocalReforgedAccount,
  disconnectMudTerminal,
  getKalismorCharacters,
  getLauncherNews,
  getReforgedProfile,
  openMinecraftLauncher,
  openReforgedClient,
  prepareReforgedLaunch,
  recordShadowsLaunch,
  repairReforgedInstall,
  repairShadowsInstall,
  runWithFreshAethroSession,
  requestKalismorLoginToken,
  sendMudTerminalInput,
  setReforgedGamePassword,
  setReforgedInstallDir,
  type MudTerminalOutput
} from '../lib/api';
import type {
  AuthSession,
  KalismorCharacter,
  KalismorLoginToken,
  LauncherHome,
  LocalMinecraftProfile,
  LocalReforgedAccount,
  ModpackCheckResult,
  ModpackFileStatus,
  NewsFeedId,
  ReforgedProfile,
  ShadowsRepairProgress
} from '../lib/types';

type Props = {
  session: AuthSession;
  home: LauncherHome;
  onLogout: () => void;
  onSessionUpdated: (session: AuthSession) => void;
};

type LauncherView = 'home' | 'shadows' | 'aethro-online' | 'reforged';
type ShadowsInstallState = 'notChecked' | 'checking' | 'needsUpdate' | 'installing' | 'ready' | 'failed';
type LauncherUpdateState = 'idle' | 'checking' | 'available' | 'installing' | 'restarting' | 'failed';
type NewsRefreshState = 'idle' | 'refreshing' | 'failed';
type NewsSourceFilter = 'all' | 'official' | 'forum';
type KalismorClientChoice = 'launcher' | 'external';

const FEED_TABS: Array<{ id: 'all' | NewsFeedId; label: string }> = [
  { id: 'all', label: 'All News' },
  { id: 'play-aethro-launcher', label: 'Launcher' },
  { id: 'aethro-online', label: 'Aethro Online' },
  { id: 'aethro-reforged', label: 'Reforged' },
  { id: 'shadows-of-aethro', label: 'Shadows' }
];

const SHADOWS_EVENT = {
  title: 'Sunfire Isles',
  url: 'https://playaethro.online/games/shadows-of-aethro/pages/sunfire-isles'
};

const AETHRO_ONLINE_STORE_URL = 'https://aethro.online/store';
const AETHRO_ONLINE_FORUMS_URL = 'https://aethro.online/forums';
const PLAY_AETHRO_ACCOUNT_REFORGED_URL = 'https://playaethro.online/account#game-reforged';
const MUSIC_PREFERENCES_KEY = 'aethro.launcher.music.v1';

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

function reforgedUpdateStateLabel(state: ShadowsInstallState) {
  switch (state) {
    case 'notChecked':
      return 'Not checked';
    case 'checking':
      return 'Checking setup';
    case 'needsUpdate':
      return 'Update available';
    case 'installing':
      return 'Setting up';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

function worldCardClass(gameId: string) {
  if (gameId === 'shadows') return 'world-card shadows-world-card';
  if (gameId === 'aethro-online') return 'world-card kalismor-world-card';
  if (gameId === 'reforged') return 'world-card reforged-world-card';
  return 'world-card';
}

export function Dashboard({ session, home, onLogout, onSessionUpdated }: Props) {
  const launcherAudioRef = useRef<HTMLAudioElement | null>(null);
  const checkedLocalMinecraftProfileRef = useRef(false);
  const refreshedShadowsNewsRef = useRef(false);
  const kalismorTerminalRef = useRef<HTMLDivElement | null>(null);
  const kalismorTerminalInstanceRef = useRef<Terminal | null>(null);
  const kalismorMudSessionIdRef = useRef<string | null>(null);
  const kalismorSocketRef = useRef<WebSocket | null>(null);
  const [activeFeed, setActiveFeed] = useState<'all' | NewsFeedId>('all');
  const [newsSource, setNewsSource] = useState<NewsSourceFilter>('all');
  const [view, setView] = useState<LauncherView>('home');
  const [news, setNews] = useState(home.news);
  const [newsRefreshState, setNewsRefreshState] = useState<NewsRefreshState>('idle');
  const [newsRefreshMessage, setNewsRefreshMessage] = useState('');
  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(MUSIC_PREFERENCES_KEY) ?? '{}').enabled ?? true; } catch { return true; }
  });
  const [musicVolume, setMusicVolume] = useState<number>(() => {
    try { return JSON.parse(localStorage.getItem(MUSIC_PREFERENCES_KEY) ?? '{}').volume ?? 42; } catch { return 42; }
  });
  const [trackIndex, setTrackIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [modpackCheck, setModpackCheck] = useState<ModpackCheckResult | null>(null);
  const [installState, setInstallState] = useState<ShadowsInstallState>('notChecked');
  const [repairProgress, setRepairProgress] = useState<ShadowsRepairProgress | null>(null);
  const [localMinecraftProfile, setLocalMinecraftProfile] = useState<LocalMinecraftProfile | null>(null);
  const [checkingMinecraftProfile, setCheckingMinecraftProfile] = useState(false);
  const [checkingFiles, setCheckingFiles] = useState(false);
  const [repairingFiles, setRepairingFiles] = useState(false);
  const [launchingMinecraft, setLaunchingMinecraft] = useState(false);
  const [shadowsError, setShadowsError] = useState<string | null>(null);
  const [shadowsStatus, setShadowsStatus] = useState<string | null>(null);
  const [reforgedCheck, setReforgedCheck] = useState<ModpackCheckResult | null>(null);
  const [reforgedInstallState, setReforgedInstallState] = useState<ShadowsInstallState>('notChecked');
  const [reforgedProgress, setReforgedProgress] = useState<ShadowsRepairProgress | null>(null);
  const [reforgedAccount, setReforgedAccount] = useState<LocalReforgedAccount | null>(null);
  const [reforgedProfile, setReforgedProfile] = useState<ReforgedProfile | null>(null);
  const [reforgedProfileLoaded, setReforgedProfileLoaded] = useState(false);
  const [reforgedProfileLoading, setReforgedProfileLoading] = useState(false);
  const [choosingReforgedFolder, setChoosingReforgedFolder] = useState(false);
  const [checkingReforgedFiles, setCheckingReforgedFiles] = useState(false);
  const [repairingReforgedFiles, setRepairingReforgedFiles] = useState(false);
  const [launchingReforged, setLaunchingReforged] = useState(false);
  const [reforgedError, setReforgedError] = useState<string | null>(null);
  const [reforgedPassword, setReforgedPassword] = useState('');
  const [reforgedPasswordConfirmation, setReforgedPasswordConfirmation] = useState('');
  const [settingReforgedPassword, setSettingReforgedPassword] = useState(false);
  const [reforgedPasswordMessage, setReforgedPasswordMessage] = useState('');
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
  const [kalismorCommandInput, setKalismorCommandInput] = useState('');
  const [startingKalismor, setStartingKalismor] = useState(false);
  const [kalismorTerminalOpen, setKalismorTerminalOpen] = useState(false);

  async function openExternal(url: string) {
    await openUrl(url);
  }

  async function withFreshSession<T>(action: (activeSession: AuthSession) => Promise<T>): Promise<T> {
    return runWithFreshAethroSession(session, onSessionUpdated, action);
  }

  function resizeKalismorTerminal() {
    const terminal = kalismorTerminalInstanceRef.current;
    const container = kalismorTerminalRef.current;
    if (!terminal || !container) return;

    const cols = Math.max(80, Math.floor(container.clientWidth / 8.5));
    const rows = Math.max(24, Math.floor(container.clientHeight / 18));
    terminal.resize(cols, rows);
  }

  async function sendKalismorCommand(command: string) {
    const line = `${command}\r\n`;
    const terminal = kalismorTerminalInstanceRef.current;

    if (kalismorSocketRef.current?.readyState === WebSocket.OPEN) {
      kalismorSocketRef.current.send(line);
      return;
    }

    if (!kalismorMudSessionIdRef.current) {
      terminal?.writeln('Kalismor terminal is still connecting.');
      return;
    }

    await sendMudTerminalInput(kalismorMudSessionIdRef.current, line);
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
      return;
    }

    if (target === 'reforged') {
      setKalismorTerminalOpen(false);
      setView('reforged');
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

    if (gameId === 'reforged') {
      setView('reforged');
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

  useEffect(() => {
    localStorage.setItem(MUSIC_PREFERENCES_KEY, JSON.stringify({ enabled: musicEnabled, volume: musicVolume }));
  }, [musicEnabled, musicVolume]);

  const visibleNews = useMemo(() => {
    return news.filter((item) => {
      const matchesFeed = activeFeed === 'all' || item.feedId === activeFeed;
      const matchesSource = newsSource === 'all' || (item.source ?? 'official') === newsSource;
      return matchesFeed && matchesSource;
    });
  }, [activeFeed, news, newsSource]);

  const shadowsNews = useMemo(() => news.filter((item) => item.feedId === 'shadows-of-aethro'), [news]);
  const aethroOnlineNews = useMemo(() => news.filter((item) => item.feedId === 'aethro-online'), [news]);
  const selectedKalismorCharacter = useMemo(
    () => kalismorCharacters.find((character) => character.id === selectedKalismorCharacterId) ?? null,
    [kalismorCharacters, selectedKalismorCharacterId]
  );
  const activeGame = home.games.find((game) => game.id === view);
  const activeTracks = activeGame?.music?.tracks ?? [];
  const activeTrack = activeTracks[trackIndex] ?? null;
  const accountInitial = (home.user.displayName || home.user.username || 'A').slice(0, 1).toUpperCase();

  async function refreshNews() {
    setNewsRefreshState('refreshing');
    setNewsRefreshMessage('');

    try {
      const freshNews = await getLauncherNews();
      const freshShadowsCount = freshNews.filter((item) => item.feedId === 'shadows-of-aethro').length;

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
    let unlisten: (() => void) | undefined;
    let mounted = true;

    try {
      listen<ShadowsRepairProgress>('reforged-repair-progress', (event) => {
        const progress = event.payload;
        setReforgedProgress(progress);

        if (progress.phase === 'checking' || progress.phase === 'verifying') {
          setReforgedInstallState('checking');
        } else if (progress.phase === 'installing' || progress.phase === 'setup') {
          setReforgedInstallState('installing');
        } else if (progress.phase === 'ready') {
          setReforgedInstallState('ready');
        } else if (progress.phase === 'needsUpdate') {
          setReforgedInstallState('needsUpdate');
        } else if (progress.phase === 'failed') {
          setReforgedInstallState('failed');
        }
      })
        .then((cleanup) => {
          if (mounted) unlisten = cleanup;
        })
        .catch((err) => {
          console.warn('Reforged progress listener unavailable.', err);
        });
    } catch (err) {
      console.warn('Reforged progress listener unavailable.', err);
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

    if (!activeTrack || !musicEnabled) {
      audio.pause();
      return;
    }

    audio.volume = musicVolume / 100;
    audio.play().catch(() => {
      setMusicEnabled(false);
    });
  }, [activeTrack, musicEnabled, musicVolume, trackIndex]);

  useEffect(() => {
    setTrackIndex(0);
  }, [view]);

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
    if (view !== 'reforged') return;

    detectLocalReforgedAccount()
      .then((account) => setReforgedAccount(account))
      .catch(() => setReforgedAccount(null));
  }, [view, reforgedCheck?.installDir]);

  useEffect(() => {
    if (view !== 'reforged') return;

    const installDir = reforgedAccount?.installDir;
    if (!installDir || checkingReforgedFiles || repairingReforgedFiles) return;

    void checkReforgedManifestUpdate()
      .then((result) => {
        if (result.updateAvailable) {
          setReforgedInstallState('needsUpdate');
        }
      })
      .catch((err) => {
        console.warn('Reforged manifest update check unavailable.', err);
      });
  }, [
    checkingReforgedFiles,
    reforgedAccount?.installDir,
    repairingReforgedFiles,
    view
  ]);

  useEffect(() => {
    if (view !== 'reforged' || reforgedProfileLoaded || reforgedProfileLoading) return;
    void loadReforgedProfile();
  }, [view, reforgedProfileLoaded, reforgedProfileLoading]);

  useEffect(() => {
    if (!kalismorTerminalOpen || !kalismorTerminalRef.current || !selectedKalismorCharacter || !kalismorLoginToken) return;

    kalismorSocketRef.current?.close();
    kalismorTerminalInstanceRef.current?.dispose();
    kalismorMudSessionIdRef.current = null;
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
    resizeKalismorTerminal();
    const resizeTerminal = () => resizeKalismorTerminal();
    window.addEventListener('resize', resizeTerminal);
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
          kalismorMudSessionIdRef.current = sessionId;
          terminal.writeln('Connected. Login token sent.');
          resizeKalismorTerminal();
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
      window.removeEventListener('resize', resizeTerminal);
      unlistenMudOutput?.();
      if (mudSessionId) void disconnectMudTerminal(mudSessionId);
      kalismorMudSessionIdRef.current = null;
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
    window.setTimeout(resizeKalismorTerminal, 150);
    window.setTimeout(resizeKalismorTerminal, 500);

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
    if (activeTracks.length < 2) return;
    setTrackIndex((index) => (index + 1) % activeTracks.length);
  }

  function renderHubMusic() {
    return <div className="hub-music">
      {activeTrack ? <>
        <span title={activeTrack.title}>{activeTrack.title}</span>
        <button onClick={toggleMusic} aria-pressed={musicEnabled}>{musicEnabled ? 'Pause music' : 'Play music'}</button>
        <button onClick={playNextTrack} disabled={activeTracks.length < 2} aria-label="Next track">Next</button>
        <input type="range" min="0" max="100" value={musicVolume} onChange={event => updateMusicVolume(event.target.value)} aria-label="Music volume" />
        <audio ref={launcherAudioRef} src={activeTrack.src} onEnded={playNextTrack} preload="metadata" />
      </> : <span>Soundtrack coming soon</span>}
    </div>;
  }

  async function verifyShadowsFiles() {
    setCheckingFiles(true);
    setInstallState('checking');
    setRepairProgress(null);
    setShadowsError(null);
    setShadowsStatus(null);

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
    setShadowsStatus(null);

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
    setShadowsStatus(null);

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

      await openMinecraftLauncher();

      if (minecraftProfile.name && minecraftProfile.uuid) {
        try {
          await withFreshSession((activeSession) => recordShadowsLaunch(activeSession, minecraftProfile));
        } catch (err) {
          console.warn('Minecraft Launcher opened, but Shadows launch tracking could not be recorded.', err);
          setShadowsStatus('Minecraft Launcher opened. We could not sync this launch with your Aethro account right now.');
        }
      } else {
        setShadowsStatus('Minecraft Launcher opened. We could not verify your Minecraft account yet, so this launch was not synced.');
      }
    } catch (err) {
      setShadowsError(err instanceof Error ? err.message : String(err || 'Unable to open Minecraft Launcher.'));
    } finally {
      setLaunchingMinecraft(false);
    }
  }

  async function chooseReforgedFolder() {
    setChoosingReforgedFolder(true);
    setReforgedError(null);

    try {
      const selected = await openDialog({
        title: 'Choose where Aethro: Reforged should be installed',
        directory: true,
        multiple: false,
        canCreateDirectories: true
      });

      if (!selected || Array.isArray(selected)) return;

      const account = await setReforgedInstallDir(selected);
      setReforgedAccount(account);
      setReforgedCheck(null);
      setReforgedProgress(null);
      setReforgedInstallState('checking');
      setRepairingReforgedFiles(true);

      const result = await repairReforgedInstall();
      setReforgedCheck(result);
      setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
      await refreshReforgedAccount();
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to save and patch Reforged.'));
    } finally {
      setChoosingReforgedFolder(false);
      setRepairingReforgedFiles(false);
    }
  }

  async function refreshReforgedAccount() {
    try {
      setReforgedAccount(await detectLocalReforgedAccount());
      await loadReforgedProfile();
    } catch (err) {
      setReforgedAccount(null);
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to read Reforged folder.'));
    }
  }

  async function loadReforgedProfile() {
    setReforgedProfileLoading(true);
    setReforgedError(null);

    try {
      const profile = await withFreshSession((activeSession) => getReforgedProfile(activeSession));
      setReforgedProfile(profile);
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to load your Reforged account.'));
    } finally {
      setReforgedProfileLoaded(true);
      setReforgedProfileLoading(false);
    }
  }

  async function submitReforgedPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPassword = reforgedPassword;
    const nextPasswordConfirmation = reforgedPasswordConfirmation;

    setReforgedPasswordMessage('');

    if (nextPassword.length < 8 || nextPassword.length > 16) {
      setReforgedError('Aethro: Reforged passwords must be 8-16 characters.');
      return;
    }

    if (!/^[\x20-\x7E]+$/.test(nextPassword)) {
      setReforgedError('Use standard letters, numbers, and symbols only.');
      return;
    }

    if (!/[A-Za-z]/.test(nextPassword) || !/[0-9]/.test(nextPassword)) {
      setReforgedError('Use at least one letter and one number.');
      return;
    }

    if (nextPassword !== nextPasswordConfirmation) {
      setReforgedError('Password confirmation does not match.');
      return;
    }

    setSettingReforgedPassword(true);
    setReforgedError(null);

    try {
      const profile = await withFreshSession((activeSession) =>
        setReforgedGamePassword(activeSession, nextPassword, nextPasswordConfirmation)
      );
      setReforgedProfile(profile);
      setReforgedProfileLoaded(true);
      setReforgedPassword('');
      setReforgedPasswordConfirmation('');
      setReforgedPasswordMessage(`Reforged password saved. Game username: ${profile.account.username}.`);
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to save your Reforged password.'));
    } finally {
      setSettingReforgedPassword(false);
    }
  }

  async function verifyReforgedFiles() {
    setCheckingReforgedFiles(true);
    setReforgedInstallState('checking');
    setReforgedProgress(null);
    setReforgedError(null);

    try {
      const result = await checkReforgedInstall();
      setReforgedCheck(result);
      setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
      await refreshReforgedAccount();
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to verify Reforged setup.'));
    } finally {
      setCheckingReforgedFiles(false);
    }
  }

  async function repairReforgedFiles() {
    setRepairingReforgedFiles(true);
    setReforgedInstallState('checking');
    setReforgedProgress(null);
    setReforgedError(null);

    try {
      const result = await repairReforgedInstall();
      setReforgedCheck(result);
      setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
      await refreshReforgedAccount();
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to set up Reforged.'));
    } finally {
      setRepairingReforgedFiles(false);
    }
  }

  async function launchReforgedClient() {
    setLaunchingReforged(true);
    setReforgedError(null);

    try {
      const launchPreparation = await prepareReforgedLaunch(reforgedCheck?.manifestSha256);
      const canLaunchWithoutRepair =
        reforgedCheck?.ready
        && reforgedInstallState === 'ready'
        && launchPreparation.ready;

      if (!canLaunchWithoutRepair) {
        setRepairingReforgedFiles(true);
        setReforgedInstallState('checking');
        setReforgedProgress(null);
        const result = await repairReforgedInstall();
        setReforgedCheck(result);
        setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
        await refreshReforgedAccount();
      }

      await openReforgedClient();
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to open Reforged.'));
    } finally {
      setLaunchingReforged(false);
      setRepairingReforgedFiles(false);
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

  if (view === 'reforged') {
    const hasReforgedDestination = Boolean(reforgedAccount?.installDir);
    const hasReforgedClient = reforgedAccount?.isClientInstalled ?? false;
    const updatesReady = reforgedCheck?.ready ?? false;
    const hasReforgedUpdate = hasReforgedDestination
      && (reforgedInstallState === 'needsUpdate' || (reforgedCheck !== null && !reforgedCheck.ready));
    const reforgedPrimaryAction = hasReforgedUpdate ? repairReforgedFiles : launchReforgedClient;
    const reforgedPrimaryLabel = hasReforgedUpdate
      ? repairingReforgedFiles ? 'Updating...' : 'Update'
      : launchingReforged ? 'Opening...' : 'Open Reforged';
    const progressPercent = reforgedProgress?.totalBytes
      ? Math.min(100, Math.round((reforgedProgress.downloadedBytes / reforgedProgress.totalBytes) * 100))
      : updatesReady
        ? 100
        : reforgedCheck?.totalFiles
          ? Math.round((reforgedCheck.okFiles / reforgedCheck.totalFiles) * 100)
          : 0;
    const progressDetail = reforgedProgress?.totalFiles
      ? `${reforgedProgress.currentIndex}/${reforgedProgress.totalFiles} setup step`
      : reforgedCheck
        ? `${reforgedCheck.okFiles}/${reforgedCheck.totalFiles} setup files verified`
        : reforgedInstallState === 'checking'
          ? 'Starting scan'
        : reforgedInstallState === 'installing'
            ? 'Setting up client'
            : hasReforgedClient
              ? 'No setup check yet'
              : hasReforgedDestination
                ? 'Ready to install'
                : 'No folder selected';
    const statusMessage = reforgedProgress?.message
      || (reforgedCheck ? reforgedCheck.installDir : hasReforgedDestination
        ? 'Check the Reforged setup before connecting.'
        : 'Choose or create an install folder for Aethro: Reforged.');

    return (
      <GameHub key="reforged" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={news.filter(item => item.feedId === 'aethro-reforged')}
        onHome={() => setView('home')} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: !hasReforgedDestination ? 'Choose install folder' : !hasReforgedClient ? 'Install Reforged' : reforgedPrimaryLabel,
          disabled: launchingReforged || repairingReforgedFiles || checkingReforgedFiles || choosingReforgedFolder,
          action: () => { void (!hasReforgedDestination ? chooseReforgedFolder() : !hasReforgedClient ? repairReforgedFiles() : reforgedPrimaryAction()); } }}
        status={repairingReforgedFiles ? `Updating · ${progressPercent}%` : hasReforgedUpdate ? 'Update available' : hasReforgedClient ? 'Client installed' : 'Setup required'}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{reforgedError && <p className="error">{reforgedError}</p>}</>}
        summary={<div className="hub-roster">{reforgedProfileLoading ? <p>Loading characters…</p> : reforgedProfile?.characters.length ? reforgedProfile.characters.slice(0, 5).map(character => <div className="hub-character" key={character.id}><span className="hub-character-initial">{character.name.slice(0, 1)}</span><div><strong>{character.name}</strong><small>Level {character.level} · {character.online ? 'Online' : 'Offline'}</small></div></div>) : <p>Your characters will appear here when your account is connected and your roster is available.</p>}</div>}
      >
        <section className="reforged-layout">
          <div className="panel">
            <div className="panel-heading">
              <h2>Client</h2>
              <span>{home.user.displayName}</span>
            </div>

            <div className={`install-status install-status-${reforgedInstallState}`}>
              <div className="install-status-heading">
                <div>
                  <span className="eyebrow">Client Status</span>
                  <strong>
                    {hasReforgedDestination
                      ? reforgedUpdateStateLabel(reforgedInstallState)
                      : 'Folder required'}
                  </strong>
                </div>
                <span>{progressDetail}</span>
              </div>

              <div className="progress-track" aria-label="Reforged update progress">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="install-status-detail">
                <span>{statusMessage}</span>
                {reforgedProgress?.totalBytes ? (
                  <span>{formatBytes(reforgedProgress.downloadedBytes)} / {formatBytes(reforgedProgress.totalBytes)}</span>
                ) : null}
              </div>

              {reforgedProgress?.currentFile ? <p>{reforgedProgress.currentFile}</p> : null}
            </div>

            <div className="patch-actions">
              <button className="secondary" onClick={chooseReforgedFolder} disabled={choosingReforgedFolder || repairingReforgedFiles || checkingReforgedFiles}>
                {choosingReforgedFolder ? 'Choosing...' : 'Choose Install Folder'}
              </button>
              <button className="secondary" onClick={verifyReforgedFiles} disabled={checkingReforgedFiles || repairingReforgedFiles || !hasReforgedDestination}>
                {checkingReforgedFiles ? 'Checking...' : 'Check install'}
              </button>
              <button onClick={repairReforgedFiles} disabled={repairingReforgedFiles || checkingReforgedFiles || !hasReforgedDestination}>
                {repairingReforgedFiles ? 'Setting up...' : 'Install / Repair Setup'}
              </button>
              <button className={hasReforgedUpdate ? undefined : 'secondary'} onClick={reforgedPrimaryAction} disabled={launchingReforged || repairingReforgedFiles || checkingReforgedFiles || !hasReforgedDestination}>
                {checkingReforgedFiles ? 'Checking...' : reforgedPrimaryLabel}
              </button>
            </div>

            {reforgedError && <p className="error">{reforgedError}</p>}

            {reforgedCheck && showDetails && (
              <div className="patch-summary">
                <div>
                  <strong>{reforgedCheck.ready ? 'Setup ready' : 'Update available'}</strong>
                  <span>{reforgedCheck.okFiles}/{reforgedCheck.totalFiles} setup files verified</span>
                </div>
                <p>{reforgedCheck.installDir}</p>
                <div className="patch-counts">
                  <span>{reforgedCheck.missingFiles} missing</span>
                  <span>{reforgedCheck.changedFiles} changed</span>
                  <span>{reforgedCheck.invalidManifestFiles} manifest issues</span>
                </div>
              </div>
            )}

            {reforgedCheck && showDetails && reforgedCheck.files.length > 0 && (
              <div className="file-list">
                {reforgedCheck.files.slice(0, 8).map((file) => (
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
              <h2>Account</h2>
              <button className="secondary compact-button" onClick={refreshReforgedAccount} disabled={reforgedProfileLoading}>
                {reforgedProfileLoading ? 'Refreshing' : 'Refresh'}
              </button>
            </div>

            <div className="identity-box">
              <span className="eyebrow">Aethro Account</span>
              <strong>{reforgedProfile?.account.username || (reforgedProfileLoading ? 'Loading...' : 'Not loaded yet')}</strong>
              <p>
                {reforgedProfileLoading
                  ? 'Loading your Play Aethro Reforged account.'
                  : reforgedProfile?.account.passwordSet
                  ? 'This is the Reforged login linked to your Play Aethro account.'
                  : 'Set your Aethro: Reforged password before connecting.'}
              </p>
              <details className="hub-details" open={!reforgedProfile?.account.passwordSet}>
                <summary>{reforgedProfile?.account.passwordSet ? 'Change game password' : 'Set up your game password'}</summary>
              <form className="reforged-password-form" onSubmit={submitReforgedPassword}>
                <label>
                  <span>Game Password</span>
                  <input
                    type="password"
                    minLength={8}
                    maxLength={16}
                    autoComplete="new-password"
                    value={reforgedPassword}
                    onChange={(event) => setReforgedPassword(event.target.value)}
                    disabled={settingReforgedPassword || reforgedProfileLoading}
                    required
                  />
                </label>
                <label>
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    minLength={8}
                    maxLength={16}
                    autoComplete="new-password"
                    value={reforgedPasswordConfirmation}
                    onChange={(event) => setReforgedPasswordConfirmation(event.target.value)}
                    disabled={settingReforgedPassword || reforgedProfileLoading}
                    required
                  />
                </label>
                {reforgedPasswordMessage && <p className="success">{reforgedPasswordMessage}</p>}
                <div className="reforged-password-actions">
                  <button
                    type="submit"
                    disabled={
                      settingReforgedPassword ||
                      reforgedProfileLoading ||
                      reforgedPassword.length === 0 ||
                      reforgedPasswordConfirmation.length === 0
                    }
                  >
                    {settingReforgedPassword
                      ? 'Saving...'
                      : reforgedProfile?.account.passwordSet
                        ? 'Update Password'
                        : 'Set Password'}
                  </button>
                  <button
                    type="button"
                    className="secondary compact-button"
                    onClick={() => openExternal(PLAY_AETHRO_ACCOUNT_REFORGED_URL)}
                  >
                    Account
                  </button>
                </div>
              </form>
              </details>
            </div>

            <div className="reforged-roster-box">
              <span className="eyebrow">Selected Folder</span>
              <strong>{reforgedAccount?.installDir || 'No folder selected'}</strong>
              <p>
                {hasReforgedClient
                  ? 'This folder contains the WoW client Reforged will use.'
                  : reforgedAccount?.message || 'Choose an install folder, then run Install / Repair Setup.'}
              </p>
            </div>

            <div className="reforged-roster-box">
              <span className="eyebrow">Characters</span>
              <strong>
                {reforgedProfileLoading
                  ? 'Loading roster'
                  : reforgedProfile?.characters.length
                    ? `${reforgedProfile.characters.length} found`
                    : 'No characters yet'}
              </strong>
              {!reforgedProfile?.charactersAvailable && (
                <p>Character lookup is temporarily unavailable.</p>
              )}
              {reforgedProfile?.charactersAvailable && reforgedProfile?.characters.length === 0 && (
                <p>Your characters will appear here after you create them on the realm.</p>
              )}
              {reforgedProfile?.characters.length ? (
                <div className="reforged-character-list">
                  {reforgedProfile.characters.slice(0, 5).map((character) => (
                    <div key={character.id} className="reforged-character-row">
                      <div>
                        <strong>{character.name}</strong>
                        <span>Level {character.level}</span>
                      </div>
                      <span>{character.online ? 'Online' : character.lastPlayedAt ? formatDate(character.lastPlayedAt) : 'Offline'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="reforged-roster-box">
              <span className="eyebrow">Realm</span>
              <strong>Aethro: Reforged</strong>
              <p>The launcher keeps your selected client pointed at Aethro.</p>
            </div>
          </div>
        </section>
      </GameHub>
    );
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
            <form
              className="kalismor-terminal-input"
              onSubmit={(event) => {
                event.preventDefault();
                void sendKalismorCommand(kalismorCommandInput).then(() => {
                  setKalismorCommandInput('');
                });
              }}
            >
              <span aria-hidden="true">&gt;</span>
              <input
                value={kalismorCommandInput}
                onChange={(event) => setKalismorCommandInput(event.target.value)}
                placeholder="Type a command..."
                autoComplete="off"
                autoFocus
              />
              <button type="submit">Send</button>
            </form>
          </section>
        </main>
      );
    }

    return (
      <GameHub key="kalismor" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={aethroOnlineNews}
        onHome={() => setView('home')} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: startingKalismor ? 'Connecting…' : 'Enter Kalismor', disabled: startingKalismor || !selectedKalismorCharacter, action: () => { void startKalismorLogin(); } }}
        status={selectedKalismorCharacter ? `Playing as ${selectedKalismorCharacter.name}` : 'Choose a character in Account & setup'}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{kalismorError && <p className="error">{kalismorError}</p>}</>}
        summary={<div className="hub-roster">{kalismorLoading ? <p>Loading characters…</p> : kalismorCharacters.length ? kalismorCharacters.map(character => <button aria-pressed={selectedKalismorCharacterId === character.id} className="hub-character" key={character.id} onClick={() => setSelectedKalismorCharacterId(character.id)}><span className="hub-character-initial">{character.name.slice(0, 1)}</span><span><strong>{character.name}</strong><small>{character.className || 'Adventurer'}{character.level ? ` · Level ${character.level}` : ''}</small></span></button>) : <p>Create your first character in Account & setup, then choose how you want to connect.</p>}</div>}
      >
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
      </GameHub>
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
      <GameHub key="shadows" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={shadowsNews}
        onHome={() => setView('home')} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: repairingFiles ? 'Installing…' : launchingMinecraft ? 'Opening…' : ready ? 'Open Minecraft' : 'Install / update',
          disabled: repairingFiles || checkingFiles || launchingMinecraft,
          action: () => { void (ready ? launchMinecraftLauncher() : repairShadowsFiles()); } }}
        status={repairingFiles ? `Installing · ${progressPercent}%` : ready ? 'Ready to play' : 'Prepare your client to play'}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{shadowsError && <p className="error">{shadowsError}</p>}{shadowsStatus && <p className="success">{shadowsStatus}</p>}</>}
        summary={<div className="hub-roster"><div className="hub-character"><span className="hub-character-initial">{(minecraftName || '?').slice(0, 1)}</span><div><strong>{minecraftName || 'Minecraft account'}</strong><small>{minecraftName ? 'Linked player' : 'Link your Minecraft identity in Account & setup'}</small></div></div><p>Explore, build, and catch up with your community.</p><button className="hub-event-link" onClick={() => void openExternal(SHADOWS_EVENT.url)}>{SHADOWS_EVENT.title} · Event details →</button></div>}
      >
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
            {shadowsStatus && <p className="success">{shadowsStatus}</p>}

            {modpackCheck && showDetails && (
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

            {modpackCheck && showDetails && modpackCheck.files.length > 0 && (
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
      </GameHub>
    );
  }

  return (
    <main className="dashboard home-dashboard reference-home">
      <header className="home-topbar">
        <div className="home-brand">
          <div className="home-brand-mark"><span>PA</span></div>
          <div>
            <h1>Play Aethro Launcher</h1>
          </div>
          <div className="reference-greeting">Welcome back!<small>Good to see you again.</small></div>
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
          <div className="reference-account"><span className="home-avatar">{home.user.avatarUrl ? <img src={home.user.avatarUrl} alt="" /> : accountInitial}</span><span>{home.user.displayName}</span></div>
        </div>
      </header>

      {renderLauncherUpdateNotice()}

      <section className="home-command-bar">
        <div>
          <h2>Enter the Aethro realms.</h2>
        </div>
        <div className="home-account-card compact-account-card">
          <div className="home-avatar">{home.user.avatarUrl ? <img src={home.user.avatarUrl} alt="" /> : accountInitial}</div>
          <div>
            <span className="eyebrow">Signed In</span>
            <strong>{home.user.displayName}</strong>
          </div>
        </div>
      </section>

      <section className="home-layout home-layout-streamlined">
        <div className="worlds-panel compact-worlds-panel">
          <div className="section-heading">
            <div>
              <h2>My Games</h2>
            </div>
          </div>

          <div className="world-grid compact-world-grid">
            {home.games.map((game) => (
              <article key={game.id} className={worldCardClass(game.id)}>
                <div className="world-card-art" aria-hidden="true">
                  <span />
                </div>
                <div className="world-card-content">
                  <div className="world-card-main">
                    <div className="world-card-badges">
                      <span className={`status ${game.status}`}>{game.status}</span>
                      {game.premium && (
                        <span className={`premium-badge premium-${game.premium.status}`}>
                          {game.premium.status === 'active' ? 'Premium Active' : game.premium.label ?? 'Premium'}
                        </span>
                      )}
                    </div>
                    <h3>{game.title}</h3>
                    {showDetails && <p>{game.description}</p>}
                  </div>
                  <div className="world-card-actions">
                    <button className="icon-button" onClick={() => playGame(game.id)}>
                      <span className="button-icon icon-play" aria-hidden="true" />
                      Play
                    </button>
                    {game.links?.vote && <button className="secondary compact-button" onClick={() => openExternal(game.links!.vote!)}>Vote</button>}
                    {game.links?.shop && <button className="secondary compact-button" onClick={() => openExternal(game.links!.shop!)}>Shop</button>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <button className="link-button details-toggle" onClick={() => setShowDetails((visible) => !visible)}>
            {showDetails ? 'Hide world details' : 'Show all world details'}
          </button>
        </div>

        <aside className="home-news-panel">
          <div className="section-heading">
            <div>
              <h2>Network News</h2>
            </div>
          </div>

          <div className="news-source-tabs" aria-label="News source">
            {(['all', 'official', 'forum'] as const).map((source) => (
              <button key={source} className={newsSource === source ? 'active' : ''} onClick={() => setNewsSource(source)}>
                {source === 'all' ? 'All updates' : source === 'official' ? 'Official' : 'Forums'}
              </button>
            ))}
          </div>

          <div className="feed-tabs home-feed-tabs" hidden={!showDetails}>
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
            ) : visibleNews.slice(0, 5).map((item) => (
              <article key={item.id} className="news-item">
                <div className="news-meta">
                  <span>{item.source === 'forum' ? 'Community Forums' : item.feedName}</span>
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
