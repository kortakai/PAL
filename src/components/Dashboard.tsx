import { GameHub, type HubTab } from './GameHub';
import HomeIcon from 'lucide-react/dist/esm/icons/home.js';
import Gamepad2 from 'lucide-react/dist/esm/icons/gamepad-2.js';
import LibraryIcon from 'lucide-react/dist/esm/icons/library.js';
import DownloadIcon from 'lucide-react/dist/esm/icons/download.js';
import SettingsIcon from 'lucide-react/dist/esm/icons/settings.js';
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.js';
import AppleIcon from 'lucide-react/dist/esm/icons/apple.js';
import SearchIcon from 'lucide-react/dist/esm/icons/search.js';
import MegaphoneIcon from 'lucide-react/dist/esm/icons/megaphone.js';
import UserRoundIcon from 'lucide-react/dist/esm/icons/user-round.js';
import VolumeXIcon from 'lucide-react/dist/esm/icons/volume-x.js';
import WrenchIcon from 'lucide-react/dist/esm/icons/wrench.js';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check as checkLauncherUpdate, type Update } from '@tauri-apps/plugin-updater';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
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
  getDominionAccess,
  getLauncherStaffAccess,
  getReforgedStaffAudit,
  getKalismorCharacters,
  getLauncherNews,
  getReforgedProfile,
  getReforgedMacRuntime,
  openMinecraftLauncher,
  openWoWSilicon,
  openReforgedClient,
  prepareReforgedLaunch,
  recordShadowsLaunch,
  repairReforgedInstall,
  repairShadowsInstall,
  runWithFreshAethroSession,
  requestKalismorLoginToken,
  requestDominionLaunch,
  sendMudTerminalInput,
  setReforgedMacShortcut,
  setReforgedInstallDir,
  getRecentWoWSiliconShortcutDirectory,
  searchReforgedStaffPlayers,
  runReforgedStaffAction,
  setReforgedGamePassword,
  type MudTerminalOutput
} from '../lib/api';
import type {
  AuthSession,
  DominionAccess,
  KalismorCharacter,
  KalismorLoginToken,
  LauncherHome,
  LocalMinecraftProfile,
  LocalReforgedAccount,
  ModpackCheckResult,
  ModpackFileStatus,
  ReforgedProfile,
  ReforgedMacRuntime,
  ReforgedManifestUpdate,
  LauncherStaffAccess,
  LauncherStaffAction,
  LauncherStaffAuditEntry,
  LauncherStaffPlayer,
  ShadowsRepairProgress
} from '../lib/types';

type Props = {
  session: AuthSession;
  home: LauncherHome;
  onLogout: () => void;
  onSessionUpdated: (session: AuthSession) => void;
};

type LauncherView = 'home' | 'launcher-settings' | 'shadows' | 'aethro-online' | 'reforged' | 'dominion';
type ShadowsInstallState = 'notChecked' | 'checking' | 'needsUpdate' | 'installing' | 'ready' | 'failed';
type LauncherUpdateState = 'idle' | 'checking' | 'available' | 'installing' | 'restarting' | 'failed';
type NewsRefreshState = 'idle' | 'refreshing' | 'failed';
type KalismorClientChoice = 'launcher' | 'external';

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
  if (gameId === 'dominion') return 'world-card dominion-world-card';
  return 'world-card';
}

export function Dashboard({ session, home, onLogout, onSessionUpdated }: Props) {
  const launcherAudioRef = useRef<HTMLAudioElement | null>(null);
  const homeGamesRef = useRef<HTMLElement | null>(null);
  const checkedLocalMinecraftProfileRef = useRef(false);
  const refreshedShadowsNewsRef = useRef(false);
  const kalismorTerminalRef = useRef<HTMLDivElement | null>(null);
  const kalismorTerminalInstanceRef = useRef<Terminal | null>(null);
  const kalismorMudSessionIdRef = useRef<string | null>(null);
  const kalismorSocketRef = useRef<WebSocket | null>(null);
  const [view, setView] = useState<LauncherView>('home');
  const [homeHubTab, setHomeHubTab] = useState<HubTab | undefined>();
  const [homeNavigation, setHomeNavigation] = useState<'home' | 'games'>('home');
  const [news, setNews] = useState(home.news);
  const [newsRefreshState, setNewsRefreshState] = useState<NewsRefreshState>('idle');
  const [newsRefreshMessage, setNewsRefreshMessage] = useState('');
  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(MUSIC_PREFERENCES_KEY) ?? '{}').enabled ?? true; } catch { return true; }
  });
  const [musicVolume, setMusicVolume] = useState<number>(() => {
    try { return JSON.parse(localStorage.getItem(MUSIC_PREFERENCES_KEY) ?? '{}').volume ?? 42; } catch { return 42; }
  });
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState('');
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
  const [reforgedManifestUpdate, setReforgedManifestUpdate] = useState<ReforgedManifestUpdate | null>(null);
  const [checkingReforgedManifest, setCheckingReforgedManifest] = useState(false);
  const [reforgedInstallState, setReforgedInstallState] = useState<ShadowsInstallState>('notChecked');
  const [reforgedProgress, setReforgedProgress] = useState<ShadowsRepairProgress | null>(null);
  const [reforgedAccount, setReforgedAccount] = useState<LocalReforgedAccount | null>(null);
  const [reforgedMacRuntime, setReforgedMacRuntime] = useState<ReforgedMacRuntime | null>(null);
  const [choosingWoWSiliconShortcut, setChoosingWoWSiliconShortcut] = useState(false);
  const [reforgedProfile, setReforgedProfile] = useState<ReforgedProfile | null>(null);
  const [reforgedProfileLoaded, setReforgedProfileLoaded] = useState(false);
  const [reforgedProfileLoading, setReforgedProfileLoading] = useState(false);
  const [choosingReforgedFolder, setChoosingReforgedFolder] = useState(false);
  const [checkingReforgedFiles, setCheckingReforgedFiles] = useState(false);
  const [repairingReforgedFiles, setRepairingReforgedFiles] = useState(false);
  const [launchingReforged, setLaunchingReforged] = useState(false);
  const [reforgedError, setReforgedError] = useState<string | null>(null);
  const [reforgedPasswordDialogOpen, setReforgedPasswordDialogOpen] = useState(false);
  const [reforgedPassword, setReforgedPassword] = useState('');
  const [reforgedPasswordConfirmation, setReforgedPasswordConfirmation] = useState('');
  const [savingReforgedPassword, setSavingReforgedPassword] = useState(false);
  const [reforgedPasswordError, setReforgedPasswordError] = useState<string | null>(null);
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
  const [dominionAccess, setDominionAccess] = useState<DominionAccess | null>(null);
  const [dominionAccessLoading, setDominionAccessLoading] = useState(false);
  const [dominionLaunching, setDominionLaunching] = useState(false);
  const [dominionError, setDominionError] = useState<string | null>(null);
  const [launcherStaffAccess, setLauncherStaffAccess] = useState<LauncherStaffAccess | null>(null);
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [staffPlayers, setStaffPlayers] = useState<LauncherStaffPlayer[]>([]);
  const [staffPlayer, setStaffPlayer] = useState<LauncherStaffPlayer | null>(null);
  const [staffSearching, setStaffSearching] = useState(false);
  const [staffAudit, setStaffAudit] = useState<LauncherStaffAuditEntry[]>([]);
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffBroadcast, setStaffBroadcast] = useState('');
  const [staffReason, setStaffReason] = useState('');
  const [staffMuteMinutes, setStaffMuteMinutes] = useState('30');
  const [staffNotice, setStaffNotice] = useState('');
  const [staffError, setStaffError] = useState('');

  async function openExternal(url: string) {
    await openUrl(url);
  }

  async function openDominionBrowser(url: string) {
    const existing = await WebviewWindow.getByLabel('dominion');
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const browser = new WebviewWindow('dominion', {
      url,
      title: 'Dominion — Play Aethro',
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 680,
      center: true,
      resizable: true
    });

    await new Promise<void>((resolve, reject) => {
      browser.once('tauri://created', () => resolve());
      browser.once('tauri://error', (event) => reject(new Error(String(event.payload))));
    });
  }

  async function withFreshSession<T>(action: (activeSession: AuthSession) => Promise<T>): Promise<T> {
    return runWithFreshAethroSession(session, onSessionUpdated, action);
  }

  useEffect(() => {
    let active = true;
    setLauncherStaffAccess(null);
    void withFreshSession((activeSession) => getLauncherStaffAccess(activeSession))
      .then((access) => { if (active) setLauncherStaffAccess(access); })
      .catch(() => { if (active) setLauncherStaffAccess({ games: {} }); });
    return () => { active = false; };
  }, [session.accessToken]);

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
      return;
    }

    if (target === 'dominion') {
      setKalismorTerminalOpen(false);
      setView('dominion');
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

    if (gameId === 'dominion') {
      setView('dominion');
      return;
    }

    alert(`${gameId} launcher flow not wired yet.`);
  }

  function renderGameLibrary() {
    const art: Record<string, string> = {
      reforged: '/images/game-reforged-home.png',
      'aethro-online': '/images/game-kalismor-home.png',
      dominion: '/images/game-dominion-home.png',
      shadows: '/images/game-shadows-home.png'
    };
    return <div className="hub-library-grid">{home.games.map((game) => <article className="hub-library-game" key={game.id}>
      <div className="hub-library-art" style={{ backgroundImage: `linear-gradient(0deg,#070c13e8,transparent 78%),url(${art[game.id] || art.reforged})` }} />
      <div className="hub-library-copy"><div className="hub-library-meta"><span className={`hub-server server-${game.status}`}><i />{game.status}</span>{game.premium?.status === 'active' && <span className="hub-premium">Premium active</span>}</div><h3>{game.title}</h3><p>{game.description}</p><button onClick={() => playGame(game.id)}>Open game →</button></div>
    </article>)}</div>;
  }

  function openHomeHubTab(tab: HubTab) {
    setHomeHubTab(tab);
    setView('reforged');
  }

  async function updateLaunchAtLogin(enabled: boolean) {
    setAutostartError('');
    try {
      if (enabled) await enableAutostart();
      else await disableAutostart();
      setLaunchAtLogin(enabled);
    } catch (error) {
      setAutostartError(error instanceof Error ? error.message : 'Could not change this setting.');
    }
  }

  function returnToLauncherHome() {
    setHomeHubTab(undefined);
    setHomeNavigation('home');
    setView('home');
  }

  function gameStaffAccess(gameId: string) {
    return launcherStaffAccess?.games[gameId]?.access === true;
  }

  function renderLinkedStaffPanel(gameId: string, heading: string, description: string) {
    const destination = launcherStaffAccess?.games[gameId]?.controlUrl;
    const url = destination ? `https://playaethro.online${destination}` : 'https://playaethro.online/staff/game-control';
    return <div className="staff-rail-content">
      <div className="staff-rail-heading"><WrenchIcon size={18} /><h2>STAFF CONTROLS · {heading}</h2></div>
      <section className="staff-rail-section"><span className="staff-rail-label">GAME OPERATIONS</span><p>{description}</p><button className="staff-open-center" onClick={() => void openExternal(url)}>Open control center <ArrowUpRight size={15} /></button></section>
      {gameId === 'dominion' && <section className="staff-rail-note"><strong>Beta access</strong><span>Manage tester access and beta status in the protected Dominion control center.</span></section>}
      {gameId === 'aethro-online' && <section className="staff-rail-note"><strong>Player management</strong><span>Access and player-stat controls are available in the protected Kalismor control center.</span></section>}
      {gameId === 'shadows-of-aethro' && <section className="staff-rail-note"><strong>Server actions</strong><span>Player lookup, delivery resends, and queued server actions remain in the protected control center.</span></section>}
      <div className="staff-rail-secure"><span>▣</span><span>Protected by Play Aethro staff permissions</span></div>
    </div>;
  }

  function openHomeGame(gameId: string) {
    if (gameId === 'aethro-online' || gameId === 'dominion' || gameId === 'reforged') {
      setHomeHubTab(undefined);
      setView(gameId);
    }
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

  useEffect(() => {
    let active = true;
    void isAutostartEnabled().then((enabled) => {
      if (active) setLaunchAtLogin(enabled);
    }).catch((error) => {
      console.warn('Unable to read launch-at-login setting.', error);
      if (active) setAutostartError('This setting is available in the installed launcher.');
    }).finally(() => {
      if (active) setAutostartLoading(false);
    });
    return () => { active = false; };
  }, []);

  const shadowsNews = useMemo(() => news.filter((item) => item.feedId === 'shadows-of-aethro'), [news]);
  const aethroOnlineNews = useMemo(() => news.filter((item) => item.feedId === 'aethro-online'), [news]);
  const selectedKalismorCharacter = useMemo(
    () => kalismorCharacters.find((character) => character.id === selectedKalismorCharacterId) ?? null,
    [kalismorCharacters, selectedKalismorCharacterId]
  );
  const activeGame = home.games.find((game) => game.id === view);
  const launcherTracks = [{ title: 'Azeroth March', src: '/audio/azeroth-march.mp3' }];
  const activeTracks = activeGame?.music?.tracks?.length ? activeGame.music.tracks : launcherTracks;
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
    if (view === 'home' && homeNavigation === 'games') {
      homeGamesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [view, homeNavigation]);

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
    if ((view !== 'aethro-online' && view !== 'home') || kalismorCharactersLoaded || kalismorLoading) return;
    void loadKalismorCharacters();
  }, [view, kalismorCharactersLoaded, kalismorLoading]);

  useEffect(() => {
    if (view !== 'reforged') return;

    detectLocalReforgedAccount()
      .then((account) => setReforgedAccount(account))
      .catch(() => setReforgedAccount(null));
    getReforgedMacRuntime()
      .then((runtime) => setReforgedMacRuntime(runtime))
      .catch(() => setReforgedMacRuntime(null));
  }, [view, reforgedCheck?.installDir]);

  useEffect(() => {
    if (view !== 'reforged') return;

    const installDir = reforgedAccount?.installDir;
    if (!installDir || checkingReforgedFiles || repairingReforgedFiles) return;

    setCheckingReforgedManifest(true);
    void checkReforgedManifestUpdate()
      .then((result) => {
        setReforgedManifestUpdate(result);
        setReforgedInstallState(result.updateAvailable ? 'needsUpdate' : 'ready');
      })
      .catch((err) => {
        console.warn('Reforged manifest update check unavailable.', err);
      })
      .finally(() => setCheckingReforgedManifest(false));
  }, [
    checkingReforgedFiles,
    reforgedAccount?.installDir,
    repairingReforgedFiles,
    view
  ]);

  useEffect(() => {
    if ((view !== 'reforged' && view !== 'home') || reforgedProfileLoaded || reforgedProfileLoading) return;
    void loadReforgedProfile();
  }, [view, reforgedProfileLoaded, reforgedProfileLoading]);

  useEffect(() => {
    if (view !== 'dominion' || dominionAccess || dominionAccessLoading) return;
    void loadDominionAccess();
  }, [view, dominionAccess, dominionAccessLoading]);

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
        {activeTracks.length > 1 && <button onClick={playNextTrack} aria-label="Next track">Next</button>}
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

  async function chooseWoWSiliconShortcut() {
    setChoosingWoWSiliconShortcut(true);
    setReforgedError(null);
    try {
      const exportDirectory = await getRecentWoWSiliconShortcutDirectory().catch(() => null);
      const selected = await openDialog({
        title: 'Choose the WoWSilicon shortcut exported for Reforged',
        defaultPath: exportDirectory ?? undefined,
        directory: false,
        multiple: false,
        filters: [{ name: 'Apple Shortcut', extensions: ['shortcut'] }]
      });
      if (!selected || Array.isArray(selected)) return;
      setReforgedMacRuntime(await setReforgedMacShortcut(selected));
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to save the WoWSilicon shortcut.'));
    } finally {
      setChoosingWoWSiliconShortcut(false);
    }
  }

  async function openWoWSiliconForRuntimeUpdates() {
    setReforgedError(null);
    try {
      await openWoWSilicon();
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to open WoWSilicon.'));
    }
  }

  async function openOrGetWoWSilicon() {
    if (reforgedMacRuntime?.appInstalled) {
      await openWoWSiliconForRuntimeUpdates();
      return;
    }
    await openExternal('https://wowsilicon.github.io/');
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

  async function loadReforgedProfile(): Promise<ReforgedProfile | null> {
    setReforgedProfileLoading(true);
    setReforgedError(null);

    try {
      const profile = await withFreshSession((activeSession) => getReforgedProfile(activeSession));
      setReforgedProfile(profile);
      return profile;
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to load your Reforged account.'));
      return null;
    } finally {
      setReforgedProfileLoaded(true);
      setReforgedProfileLoading(false);
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
      if (result.ready) setReforgedManifestUpdate({ manifestSha256: result.manifestSha256, updateAvailable: false });
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
      setReforgedManifestUpdate({ manifestSha256: result.manifestSha256, updateAvailable: !result.ready });
      setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
      await refreshReforgedAccount();
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to set up Reforged.'));
    } finally {
      setRepairingReforgedFiles(false);
    }
  }

  async function refreshReforgedManifestStatus() {
    setCheckingReforgedManifest(true);
    setReforgedError(null);
    try {
      const result = await checkReforgedManifestUpdate();
      setReforgedManifestUpdate(result);
      setReforgedInstallState(result.updateAvailable ? 'needsUpdate' : 'ready');
      return result;
    } catch (err) {
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to check the Reforged manifest.'));
      return null;
    } finally {
      setCheckingReforgedManifest(false);
    }
  }

  async function launchReforgedClient(skipPasswordCheck = false) {
    setLaunchingReforged(true);
    setReforgedError(null);

    try {
      if (!skipPasswordCheck) {
        const profile = await loadReforgedProfile();
        if (!profile) return;

        if (!profile.account.passwordSet) {
          setReforgedPasswordError(null);
          setReforgedPasswordDialogOpen(true);
          return;
        }
      }

      const launchPreparation = await prepareReforgedLaunch(reforgedCheck?.manifestSha256);
      const canLaunchWithoutRepair = launchPreparation.ready;

      if (!canLaunchWithoutRepair) {
        setRepairingReforgedFiles(true);
        setReforgedInstallState('checking');
        setReforgedProgress(null);
        const result = await repairReforgedInstall();
        setReforgedCheck(result);
        setReforgedManifestUpdate({ manifestSha256: result.manifestSha256, updateAvailable: !result.ready });
        setReforgedInstallState(result.ready ? 'ready' : 'needsUpdate');
        await refreshReforgedAccount();
      }

      await withFreshSession((activeSession) => openReforgedClient(activeSession));
    } catch (err) {
      setReforgedInstallState('failed');
      setReforgedError(err instanceof Error ? err.message : String(err || 'Unable to open Reforged.'));
    } finally {
      setLaunchingReforged(false);
      setRepairingReforgedFiles(false);
    }
  }

  async function saveReforgedPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReforgedPasswordError(null);

    if (!/^[A-Za-z0-9]{8,16}$/.test(reforgedPassword)) {
      setReforgedPasswordError('Use 8–16 letters and numbers for your Reforged password.');
      return;
    }
    if (reforgedPassword !== reforgedPasswordConfirmation) {
      setReforgedPasswordError('The two passwords do not match.');
      return;
    }

    setSavingReforgedPassword(true);
    try {
      const profile = await withFreshSession((activeSession) =>
        setReforgedGamePassword(activeSession, reforgedPassword, reforgedPasswordConfirmation)
      );
      if (!profile.account.passwordSet) {
        throw new Error('Your Reforged password could not be confirmed. Please try again.');
      }

      setReforgedProfile(profile);
      setReforgedPassword('');
      setReforgedPasswordConfirmation('');
      setReforgedPasswordDialogOpen(false);
      void launchReforgedClient(true);
    } catch (err) {
      setReforgedPasswordError(err instanceof Error ? err.message : String(err || 'Unable to save your Reforged password.'));
    } finally {
      setSavingReforgedPassword(false);
    }
  }

  function dismissReforgedPasswordPrompt() {
    setReforgedPassword('');
    setReforgedPasswordConfirmation('');
    setReforgedPasswordError(null);
    setReforgedPasswordDialogOpen(false);
  }

  async function loadDominionAccess() {
    setDominionAccessLoading(true);
    setDominionError(null);

    try {
      setDominionAccess(await withFreshSession((activeSession) => getDominionAccess(activeSession)));
    } catch (err) {
      setDominionAccess(null);
      setDominionError(err instanceof Error ? err.message : String(err || 'Unable to check Dominion access.'));
    } finally {
      setDominionAccessLoading(false);
    }
  }

  async function refreshLauncherStaffAudit() {
    if (!launcherStaffAccess?.games['aethro-reforged']?.access) return;
    try {
      setStaffAudit(await withFreshSession((activeSession) => getReforgedStaffAudit(activeSession)));
    } catch {
      setStaffAudit([]);
    }
  }

  async function searchReforgedStaffPlayer() {
    setStaffError('');
    setStaffNotice('');
    const query = staffSearchQuery.trim();
    if (query.length < 2) {
      setStaffError('Enter at least two characters to search.');
      return;
    }
    setStaffSearching(true);
    try {
      const players = await withFreshSession((activeSession) => searchReforgedStaffPlayers(activeSession, query));
      setStaffPlayers(players);
      setStaffPlayer(null);
      if (!players.length) setStaffNotice('No matching characters found.');
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : String(err || 'Player search failed.'));
    } finally {
      setStaffSearching(false);
    }
  }

  async function submitReforgedStaffAction(action: LauncherStaffAction) {
    if (action.action !== 'broadcast' && !window.confirm(`${action.action === 'kick' ? 'Kick' : 'Mute'} ${staffPlayer?.name}? This action will be recorded.`)) return;
    setStaffBusy(true);
    setStaffError('');
    setStaffNotice('');
    try {
      const result = await withFreshSession((activeSession) => runReforgedStaffAction(activeSession, action));
      setStaffNotice(result.message);
      setStaffBroadcast('');
      setStaffReason('');
      await refreshLauncherStaffAudit();
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : String(err || 'The staff action failed.'));
      await refreshLauncherStaffAudit();
    } finally {
      setStaffBusy(false);
    }
  }

  useEffect(() => {
    if (view !== 'reforged' || !launcherStaffAccess?.games['aethro-reforged']?.access) return;
    void refreshLauncherStaffAudit();
  }, [view, launcherStaffAccess, session.accessToken]);

  async function launchDominion() {
    if (!dominionAccess || dominionAccess.access === 'denied' || !dominionAccess.enabled) return;

    setDominionLaunching(true);
    setDominionError(null);

    try {
      const handoff = await withFreshSession((activeSession) => requestDominionLaunch(activeSession));
      await openDominionBrowser(handoff.launchUrl);
    } catch (err) {
      setDominionError(err instanceof Error ? err.message : String(err || 'Unable to open Dominion.'));
    } finally {
      setDominionLaunching(false);
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

  if (view === 'launcher-settings') {
    return <main className="dashboard home-dashboard reference-home launcher-settings-page">
      <aside className="launcher-sidebar">
        <button className="launcher-wordmark" onClick={returnToLauncherHome}>PLAY AETHRO</button>
        <nav className="launcher-nav" aria-label="Launcher navigation">
          <button onClick={returnToLauncherHome}><HomeIcon size={17} />Home</button>
          <button onClick={() => { setView('home'); setHomeNavigation('games'); }}><Gamepad2 size={17} />Games</button>
          <button onClick={() => openHomeHubTab('library')}><LibraryIcon size={17} />Library</button>
          <button onClick={() => openHomeHubTab('downloads')}><DownloadIcon size={17} />Downloads</button>
          <button className="active" aria-current="page"><SettingsIcon size={17} />Settings</button>
        </nav>
      </aside>
      <div className="launcher-home-stage">
        <header className="launcher-home-topbar">
          <div className="launcher-home-links"><button onClick={() => void openExternal(home.links.website)}>Website <ArrowUpRight size={13} /></button><button onClick={() => void openExternal(home.links.discord)}>Discord <ArrowUpRight size={13} /></button><button className="launcher-logout" onClick={onLogout}>Log out</button></div>
          <div className="reference-account"><span className="home-avatar">{home.user.avatarUrl ? <img src={home.user.avatarUrl} alt="" /> : accountInitial}</span><span>{home.user.displayName}</span></div>
          <div className="launcher-home-music">{renderHubMusic()}</div>
        </header>
        <section className="launcher-settings-content">
          <span className="hub-kicker">PLAY AETHRO</span><h1>Launcher settings</h1><p>Settings for the launcher itself. Game folders and client options are inside each game.</p>
          <article className="launcher-setting-row"><div><strong>Open when I sign in</strong><p>Start Play Aethro when you log in to your computer.</p></div><label className="launcher-toggle"><input type="checkbox" checked={launchAtLogin} disabled={autostartLoading} onChange={event => void updateLaunchAtLogin(event.target.checked)} /><span /></label></article>
          <article className="launcher-setting-row"><div><strong>Launcher music</strong><p>Play the launcher soundtrack while you browse.</p></div><label className="launcher-toggle"><input type="checkbox" checked={musicEnabled} onChange={event => setMusicEnabled(event.target.checked)} /><span /></label></article>
          <article className="launcher-setting-row launcher-volume-row"><div><strong>Music volume</strong><p>Current volume: {musicVolume}%</p></div><input type="range" min="0" max="100" value={musicVolume} onChange={event => setMusicVolume(Number(event.target.value))} aria-label="Launcher music volume" /></article>
          {autostartError && <p className="error" role="status">{autostartError}</p>}
          <button className="launcher-settings-back" onClick={returnToLauncherHome}>Back to Home</button>
        </section>
      </div>
    </main>;
  }

  if (view === 'reforged') {
    const hasReforgedDestination = Boolean(reforgedAccount?.installDir);
    const hasReforgedClient = reforgedAccount?.isClientInstalled ?? false;
    const manifestMatchesVerifiedInstall = reforgedManifestUpdate !== null && !reforgedManifestUpdate.updateAvailable;
    const updatesReady = reforgedManifestUpdate !== null ? manifestMatchesVerifiedInstall : (reforgedCheck?.ready ?? false);
    const hasReforgedUpdate = hasReforgedDestination && (reforgedManifestUpdate !== null
      ? reforgedManifestUpdate.updateAvailable
      : reforgedInstallState === 'needsUpdate' || (reforgedCheck !== null && !reforgedCheck.ready));
    const reforgedPrimaryAction = hasReforgedUpdate ? repairReforgedFiles : launchReforgedClient;
    const reforgedPrimaryLabel = reforgedMacRuntime?.supported && !reforgedMacRuntime.appleSilicon
      ? 'Mac not supported'
      : hasReforgedUpdate
        ? repairingReforgedFiles ? 'Updating...' : 'Update'
        : checkingReforgedManifest
          ? 'Checking manifest…'
          : reforgedManifestUpdate === null
            ? 'Check manifest'
          : reforgedMacRuntime?.supported && !reforgedMacRuntime.launchShortcut
            ? 'Connect WoWSilicon profile'
            : launchingReforged ? 'Opening...' : 'Play Reforged';
    const reforgedMacReady = Boolean(reforgedMacRuntime?.supported && reforgedMacRuntime.appleSilicon && reforgedMacRuntime.appInstalled && reforgedMacRuntime.launchShortcut);
    const reforgedClientReady = Boolean(hasReforgedClient && updatesReady);
    const reforgedPasswordDialog = reforgedPasswordDialogOpen ? (
      <div className="hub-dialog-backdrop">
        <section className="hub-dialog" role="dialog" aria-modal="true" aria-labelledby="reforged-password-title">
          <span className="hub-kicker">One last step</span>
          <h2 id="reforged-password-title">Set your Reforged password</h2>
          <p>Choose the password you will use to log in to Aethro: Reforged. Once it is saved, the launcher will open the game.</p>
          <form onSubmit={saveReforgedPassword}>
            <label htmlFor="reforged-password">Password
              <input id="reforged-password" type="password" autoComplete="new-password" value={reforgedPassword} onChange={event => setReforgedPassword(event.target.value)} disabled={savingReforgedPassword} required minLength={8} maxLength={16} />
            </label>
            <span className="hub-dialog-hint">8–16 letters and numbers</span>
            <label htmlFor="reforged-password-confirmation">Confirm password
              <input id="reforged-password-confirmation" type="password" autoComplete="new-password" value={reforgedPasswordConfirmation} onChange={event => setReforgedPasswordConfirmation(event.target.value)} disabled={savingReforgedPassword} required minLength={8} maxLength={16} />
            </label>
            {reforgedPasswordError && <p className="hub-dialog-error" role="alert">{reforgedPasswordError}</p>}
            <div className="hub-dialog-actions">
              <button type="button" className="secondary" disabled={savingReforgedPassword} onClick={dismissReforgedPasswordPrompt}>Not now</button>
              <button type="submit" disabled={savingReforgedPassword}>{savingReforgedPassword ? 'Saving…' : 'Save & play'}</button>
            </div>
          </form>
        </section>
      </div>
    ) : null;
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
    const reforgedStaff = launcherStaffAccess?.games['aethro-reforged'];
    const reforgedStaffPanel = <div className="staff-rail-content">
      <div className="staff-rail-heading"><WrenchIcon size={18} /><h2>STAFF CONTROLS · REFORGED</h2></div>
      <section className="staff-rail-section"><label className="staff-rail-label" htmlFor="staff-player-query">ACCOUNT / PLAYER SEARCH</label><div className="staff-search-row"><SearchIcon size={18} /><input id="staff-player-query" value={staffSearchQuery} onChange={event => setStaffSearchQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void searchReforgedStaffPlayer(); }} placeholder="Find player" /><button aria-label="Search Reforged players" onClick={() => void searchReforgedStaffPlayer()} disabled={staffSearching}><SearchIcon size={16} /></button></div>{staffPlayers.length > 0 && <div className="staff-player-results">{staffPlayers.map(player => <button key={player.id} aria-pressed={staffPlayer?.id === player.id} onClick={() => setStaffPlayer(player)}><UserRoundIcon size={15} /><span>{player.name}<small>Level {player.level}</small></span></button>)}</div>}{staffPlayer && <p className="staff-selected-player">Selected: <strong>{staffPlayer.name}</strong></p>}</section>
      <section className="staff-rail-section"><span className="staff-rail-label">REALM OPERATIONS</span>{reforgedStaff?.actions?.broadcast && <form className="staff-broadcast-form" onSubmit={event => { event.preventDefault(); void submitReforgedStaffAction({ action: 'broadcast', message: staffBroadcast.trim() }); }}><label htmlFor="staff-broadcast-message">Broadcast to online players</label><textarea id="staff-broadcast-message" maxLength={400} value={staffBroadcast} onChange={event => setStaffBroadcast(event.target.value)} placeholder="Write a server announcement" /><button className="staff-primary-action" disabled={staffBusy || staffBroadcast.trim().length < 3}><MegaphoneIcon size={16} />{staffBusy ? 'Sending…' : 'Broadcast'}</button></form>}<div className="staff-maintenance-note"><strong>Maintenance updates</strong><span>Post a forum update; it will appear in the launcher’s RSS feed.</span><button onClick={() => void openExternal('https://playaethro.online/forums')}>Open forums <ArrowUpRight size={13} /></button></div></section>
      <section className="staff-rail-section"><span className="staff-rail-label">PLAYER ACTIONS</span>{(reforgedStaff?.actions?.kick || reforgedStaff?.actions?.mute) ? <><label htmlFor="staff-action-reason">Reason</label><input id="staff-action-reason" className="staff-reason-input" value={staffReason} onChange={event => setStaffReason(event.target.value)} maxLength={200} placeholder="Required for player actions" />{reforgedStaff.actions.kick && <button className="staff-danger-action" disabled={!staffPlayer || staffBusy || staffReason.trim().length < 3} onClick={() => staffPlayer && void submitReforgedStaffAction({ action: 'kick', character_id: staffPlayer.id, reason: staffReason.trim() })}><UserRoundIcon size={16} />Kick</button>}{reforgedStaff.actions.mute && <div className="staff-mute-row"><input aria-label="Mute duration in minutes" type="number" min="1" max="10080" value={staffMuteMinutes} onChange={event => setStaffMuteMinutes(event.target.value)} /><button disabled={!staffPlayer || staffBusy || staffReason.trim().length < 3 || Number(staffMuteMinutes) < 1 || Number(staffMuteMinutes) > 10080} onClick={() => staffPlayer && void submitReforgedStaffAction({ action: 'mute', character_id: staffPlayer.id, minutes: Number(staffMuteMinutes), reason: staffReason.trim() })}><VolumeXIcon size={15} />Mute</button></div>}</> : <p className="staff-permission-note">Your account has view access only for this game.</p>}</section>
      {(staffError || staffNotice) && <p className={`staff-feedback${staffError ? ' is-error' : ''}`} role="status">{staffError || staffNotice}</p>}
      <section className="staff-rail-section staff-audit-section"><span className="staff-rail-label">RECENT AUDITED ACTIONS</span>{staffAudit.length ? staffAudit.map((entry, index) => <article className="staff-audit-item" key={`${entry.created_at}-${index}`}><span className={`staff-audit-icon${entry.result === 'failed' ? ' is-failed' : ''}`}>{entry.result === 'failed' ? '!' : '✓'}</span><div><strong>{entry.action}{entry.target ? ` · ${entry.target}` : ''}</strong><small>{entry.message}</small><time>{new Date(entry.created_at).toLocaleString()}</time></div></article>) : <p className="staff-permission-note">No recent staff actions.</p>}</section>
      <div className="staff-rail-secure"><span>▣</span><span>SOAP relay secured · actions audited</span></div>
    </div>;

    return (
      <GameHub key="reforged" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={news.filter(item => item.feedId === 'aethro-reforged')} initialTab={homeHubTab} reforgedMacMode={Boolean(reforgedMacRuntime?.supported)} staffAccess={gameStaffAccess('aethro-reforged')} staffPanel={reforgedStaffPanel} onOpenStaff={() => document.getElementById('staff-player-query')?.focus()}
        onHome={returnToLauncherHome} library={renderGameLibrary()} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: !hasReforgedDestination ? 'Choose install folder' : hasReforgedUpdate ? reforgedPrimaryLabel : !hasReforgedClient ? 'Install Reforged' : reforgedPrimaryLabel,
          tab: reforgedMacRuntime?.supported && reforgedMacRuntime.appleSilicon && hasReforgedClient && !reforgedMacRuntime.launchShortcut && manifestMatchesVerifiedInstall ? 'settings' : undefined,
          disabled: launchingReforged || repairingReforgedFiles || checkingReforgedFiles || checkingReforgedManifest || choosingReforgedFolder || Boolean(reforgedMacRuntime?.supported && !reforgedMacRuntime.appleSilicon),
          action: () => {
            if (!hasReforgedDestination) {
              void chooseReforgedFolder();
              return;
            }
            if (hasReforgedUpdate) {
              void repairReforgedFiles();
              return;
            }
            if (!hasReforgedClient) {
              void repairReforgedFiles();
              return;
            }
            if (!reforgedManifestUpdate) {
              void refreshReforgedManifestStatus();
              return;
            }
            if (reforgedMacRuntime?.supported && !reforgedMacRuntime.launchShortcut) {
              if (manifestMatchesVerifiedInstall) return;
              if (reforgedMacRuntime.appInstalled) void openWoWSiliconForRuntimeUpdates();
              else void openExternal('https://wowsilicon.github.io/');
              return;
            }
            void reforgedPrimaryAction();
          } }}
        status={repairingReforgedFiles ? `Updating · ${progressPercent}%` : hasReforgedUpdate ? 'Update available' : hasReforgedClient ? 'Client installed' : 'Setup required'}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{reforgedError && <p className="error">{reforgedError}</p>}</>} dialog={reforgedPasswordDialog}
        overview={(navigate) => <div className="blade-reforged">
          <section className="blade-reforged-news"><div className="blade-card-heading"><h2>Reforged news</h2><button onClick={() => navigate('news')}>All updates →</button></div>{news.filter(item => item.feedId === 'aethro-reforged').slice(0, 3).map(item => <button className="blade-reforged-news-item" key={item.id} onClick={() => void openExternal(item.url)}><span><small>{item.source === 'forum' ? 'Community forums' : item.feedName} · {formatDate(item.publishedAt)}</small><strong>{item.title}</strong><em>{item.summary}</em></span><ArrowUpRight size={15} /></button>)}{!news.some(item => item.feedId === 'aethro-reforged') && <p>Aethro: Reforged announcements will appear here.</p>}</section>
          <div className="blade-status-row">
            <div className="blade-status-tile"><span className={`blade-check${reforgedClientReady ? '' : ' needs-action'}`}>{reforgedClientReady ? '✓' : '!'}</span><span><strong>{reforgedClientReady ? 'Client Ready' : 'Client Setup'}</strong><small>{reforgedClientReady ? 'Reforged 3.3.5a' : hasReforgedUpdate ? 'Update available' : hasReforgedClient ? 'Checking manifest' : hasReforgedDestination ? 'Install required' : 'Choose install folder'}</small></span></div>
            <div className="blade-status-tile blade-mac-status"><span className={`blade-check${reforgedMacReady ? '' : ' needs-action'}`}>{reforgedMacReady ? '✓' : '!'}</span><span><strong>{reforgedMacRuntime?.supported ? reforgedMacReady ? 'Mac Ready' : 'Mac Setup' : 'Mac Runtime'}</strong><small>{reforgedMacRuntime?.supported ? !reforgedMacRuntime.appleSilicon ? 'Apple Silicon required' : reforgedMacReady ? 'WoWSilicon' : reforgedMacRuntime.launchShortcut ? 'WoWSilicon linked' : 'Connect WoWSilicon' : 'macOS only'}</small></span></div>
            <div className="blade-status-tile"><span className={`blade-check${activeGame?.status === 'online' ? '' : ' needs-action'}`}>{activeGame?.status === 'online' ? '✓' : '!'}</span><span><strong>Realm {activeGame?.status === 'online' ? 'Online' : activeGame?.status || 'Unknown'}</strong><small>Aethro · Reforged</small></span></div>
          </div>
          <div className={`blade-reforged-lower${reforgedMacRuntime?.supported ? ' blade-reforged-mac-panel' : ''}`}>
            <section className="blade-runtime-card"><div className="blade-card-heading"><h2>{reforgedMacRuntime?.supported ? 'WoWSilicon profile' : 'Reforged client'}</h2></div><div className="blade-runtime-identity"><span className="blade-apple-mark" aria-hidden="true">{reforgedMacRuntime?.supported ? <AppleIcon size={36} /> : 'A'}</span><div><strong className="blade-runtime-title">Reforged · 3.3.5a</strong><p className="blade-runtime-meta">{reforgedMacRuntime?.launchShortcut ? reforgedMacRuntime.launchShortcutName || 'WoWSilicon profile linked' : reforgedMacRuntime?.supported && reforgedMacRuntime.appInstalled && !reforgedMacRuntime.shortcutExportSupported ? `WoWSilicon ${reforgedMacRuntime.appVersion || ''} · update it to export a launcher shortcut` : reforgedMacRuntime?.supported && reforgedMacRuntime.appInstalled ? 'WoWSilicon is ready. Connect Reforged in Client settings.' : reforgedMacRuntime?.supported ? 'Install WoWSilicon, then connect Reforged in Client settings.' : 'Reforged files are checked against the current update list.'}</p></div><span className={`blade-runtime-ready${reforgedClientReady ? '' : ' is-pending'}`}>{reforgedClientReady ? '✓' : '!'}</span><button className="blade-runtime-settings" onClick={() => navigate('settings')}>Client settings <span>›</span></button></div><div className="blade-progress-track" aria-label="Client verification progress"><span style={{ width: `${progressPercent}%` }} /></div><div className="blade-runtime-foot"><span>{reforgedProgress?.message || (reforgedClientReady ? 'Up to date · Files verified' : hasReforgedUpdate ? 'Update available · Reforged 3.3.5a' : hasReforgedClient ? 'Ready to check files' : progressDetail)}</span><button onClick={() => hasReforgedUpdate ? void repairReforgedFiles() : navigate('downloads')}>{hasReforgedUpdate ? repairingReforgedFiles ? 'Updating…' : 'Update Reforged →' : 'View downloads →'}</button></div></section>
          </div>
        </div>}
        downloads={<div className="hub-downloads-content"><article className="hub-download-item"><div><span className="hub-kicker">REFORGED CLIENT</span><h3>{hasReforgedUpdate ? 'Update available' : reforgedInstallState === 'checking' ? 'Checking manifest' : hasReforgedClient ? updatesReady ? 'Up to date' : 'Installed' : 'Not installed'}</h3><p>{reforgedProgress?.message || progressDetail}</p></div><div className="hub-download-progress"><div className="blade-progress-track"><span style={{ width: `${progressPercent}%` }} /></div><div className="blade-progress-label"><span>{reforgedProgress?.currentFile || (reforgedCheck ? `${reforgedCheck.okFiles}/${reforgedCheck.totalFiles} files verified` : statusMessage)}</span><strong>{progressPercent}%</strong></div></div><div className="hub-download-actions"><button className="secondary" onClick={() => void verifyReforgedFiles()} disabled={!hasReforgedDestination || checkingReforgedFiles || repairingReforgedFiles}>{checkingReforgedFiles ? 'Checking…' : 'Check all files'}</button><button onClick={() => void repairReforgedFiles()} disabled={!hasReforgedDestination || checkingReforgedFiles || repairingReforgedFiles}>{repairingReforgedFiles ? 'Updating…' : hasReforgedClient ? 'Install update / repair' : 'Install Reforged'}</button></div></article>{reforgedMacRuntime?.supported && <article className="hub-download-item hub-runtime-item"><div><span className="hub-kicker">MAC RUNTIME</span><h3>WoWSilicon</h3><p>WoWSilicon manages Wine and graphics-runtime updates separately from Reforged game files.</p></div><button className="secondary" onClick={() => void openOrGetWoWSilicon()}>{reforgedMacRuntime.appInstalled ? 'Open WoWSilicon' : 'Get WoWSilicon'}</button></article>}</div>}
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
                {checkingReforgedFiles ? 'Checking...' : 'Check all files'}
              </button>
              <button onClick={repairReforgedFiles} disabled={repairingReforgedFiles || checkingReforgedFiles || !hasReforgedDestination}>
                {repairingReforgedFiles ? 'Setting up...' : 'Install / Repair Setup'}
              </button>
              <button className={hasReforgedUpdate ? undefined : 'secondary'} onClick={() => void reforgedPrimaryAction()} disabled={launchingReforged || repairingReforgedFiles || checkingReforgedFiles || !hasReforgedDestination || Boolean(reforgedMacRuntime?.supported && !reforgedMacRuntime.launchShortcut)}>
                {checkingReforgedFiles ? 'Checking...' : reforgedMacRuntime?.supported && !reforgedMacRuntime.launchShortcut ? 'Connect WoWSilicon profile first' : reforgedPrimaryLabel}
              </button>
            </div>

            {reforgedMacRuntime?.supported && (
              <div className="reforged-mac-runtime">
                <div className="panel-heading">
                  <h2>WoWSilicon profile</h2>
                  <span>{reforgedMacRuntime.appleSilicon ? 'Apple Silicon' : 'Apple Silicon required'}</span>
                </div>
                <p>
                  {!reforgedMacRuntime.appleSilicon
                    ? 'WoWSilicon needs an Apple Silicon Mac.'
                    : reforgedMacRuntime.launchShortcut
                    ? `Connected. Play will open Reforged with “${reforgedMacRuntime.launchShortcutName || 'your saved shortcut'}”.`
                    : 'Finish the steps below once. After that, Play will open Reforged from here.'}
                </p>
                <ol className="hub-setup-steps">
                  <li className={updatesReady ? 'step-done' : ''}><span>1</span><div><strong>Verify the Reforged client</strong><small>{updatesReady ? 'Client verified against the current manifest.' : 'Install the client, then the launcher checks it against the manifest.'}</small></div></li>
                  <li className={reforgedMacRuntime.launchShortcut ? 'step-done' : ''}><span>2</span><div><strong>Choose the Reforged game folder</strong><small>In WoWSilicon, choose the Wrath 3.3.5a profile and set Game Folder to {reforgedAccount?.installDir || 'the Reforged folder shown below'}, then select Patch.</small></div></li>
                  <li className={reforgedMacRuntime.launchShortcut ? 'step-done' : ''}><span>3</span><div><strong>Export and import its launch shortcut</strong><small>{reforgedMacRuntime.shortcutExportSupported ? 'In WoWSilicon open Options → General, scroll to Launch Shortcut, then choose Create Shortcut… → Create. Add it in Apple Shortcuts, return here, and choose the exported .shortcut file below.' : `WoWSilicon ${reforgedMacRuntime.appVersion || 'currently installed'} does not include shortcut export. Open WoWSilicon → Options → General, scroll to Check for Updates… and update to 3.2.2 or newer. Then create the shortcut from Options → General → Launch Shortcut.`} The file chooser opens in WoWSilicon’s recent export folder.</small></div></li>
                </ol>
                <div className="patch-actions">
                  <button className="secondary" onClick={() => void openOrGetWoWSilicon()} disabled={!reforgedMacRuntime.appleSilicon}>
                    {reforgedMacRuntime.appInstalled ? 'Open WoWSilicon' : 'Get WoWSilicon'}
                  </button>
                  <button onClick={chooseWoWSiliconShortcut} disabled={!reforgedMacRuntime.appleSilicon || !reforgedMacRuntime.shortcutExportSupported || choosingWoWSiliconShortcut || !reforgedMacRuntime.appInstalled || !reforgedAccount?.isClientInstalled}>
                    {choosingWoWSiliconShortcut ? 'Choosing…' : reforgedMacRuntime.launchShortcut ? 'Change launch shortcut' : 'Import Reforged shortcut'}
                  </button>
                </div>
                <small>WoWSilicon handles Wine and graphics updates. Update and verify Reforged here. Reforged repairs won’t touch WoWSilicon’s runtime files. This test build isn’t signed, so macOS may ask you to approve it the first time you open it or use its shortcut.</small>
              </div>
            )}

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

          <div className="panel reforged-technical-panel">
            <div className="panel-heading"><h2>Client details</h2><button className="secondary compact-button" onClick={() => void refreshReforgedAccount()}>Refresh</button></div>
            <div className="reforged-roster-box"><span className="eyebrow">Install folder</span><strong>{reforgedAccount?.installDir || 'No folder selected'}</strong><p>{hasReforgedClient ? 'Reforged updates and file checks use this folder.' : reforgedAccount?.message || 'Choose a folder to install Reforged.'}</p></div>
            <div className="reforged-roster-box"><span className="eyebrow">File check</span><strong>{checkingReforgedManifest ? 'Checking files…' : reforgedManifestUpdate ? reforgedManifestUpdate.updateAvailable ? 'Update available' : 'Files are up to date' : 'Not checked yet'}</strong><p>The launcher checks Reforged against the current update list before changing any files.</p></div>
          </div>
        </section>
      </GameHub>
    );
  }

  if (view === 'dominion') {
    const canPlayDominion = Boolean(dominionAccess?.enabled && dominionAccess.access !== 'denied');
    const accessLabel = dominionAccessLoading
      ? 'Checking your Aethro access…'
      : canPlayDominion
        ? dominionAccess?.access === 'staff' ? 'Staff access active' : dominionAccess?.access === 'tester' ? 'Closed-beta access active' : 'Access active'
        : dominionAccess ? 'Access not granted yet' : 'Access check unavailable';

    return (
      <GameHub key="dominion" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={[]} staffAccess={gameStaffAccess('dominion')} staffPanel={renderLinkedStaffPanel('dominion', 'DOMINION', 'Manage beta access and review the Dominion staff queue.')} onOpenStaff={() => document.querySelector<HTMLButtonElement>('.hub-staff-rail button')?.focus()}
        onHome={returnToLauncherHome} library={renderGameLibrary()} downloads={<div className="hub-download-empty"><strong>Dominion runs in its own game window.</strong><p>There are no Dominion client files to download or update in this launcher.</p></div>} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: dominionLaunching ? 'Opening Dominion…' : canPlayDominion ? 'Play Dominion' : dominionAccessLoading ? 'Checking access…' : 'Dominion access required',
          disabled: dominionLaunching || dominionAccessLoading || !canPlayDominion,
          action: () => { void launchDominion(); } }}
        status={accessLabel}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{dominionError && <p className="error">{dominionError}</p>}</>}
        overview={(navigate) => <div className="blade-dominion-overview">
          <section className="blade-dominion-access"><span className="blade-house-crest">D</span><div className="blade-dominion-copy"><span className="hub-kicker">DOMINION ACCESS</span><h2>{canPlayDominion ? 'Your realm awaits.' : 'Access is not active yet.'}</h2><p>{canPlayDominion ? 'Your Aethro account is cleared to launch Dominion.' : 'Dominion eligibility is checked against the account signed into this launcher.'}</p></div><div className="blade-access-state"><span className={`blade-check${canPlayDominion ? '' : ' needs-action'}`}>{canPlayDominion ? '✓' : '!'}</span><span>{accessLabel}</span></div></section>
          <div className="blade-dominion-actions"><button className="blade-dominion-action" onClick={() => { void loadDominionAccess(); }} disabled={dominionAccessLoading}><strong>{dominionAccessLoading ? 'Checking access…' : 'Refresh access'}</strong><small>Recheck account eligibility</small></button><button className="blade-dominion-action" onClick={() => navigate('news')}><strong>Community updates</strong><small>See Dominion news and announcements</small></button><button className="blade-dominion-action" onClick={() => void openExternal('https://dominion.playaethro.online/')}><strong>Open Dominion site ↗</strong><small>Visit the game website</small></button></div>
          <div className="blade-dominion-updates"><p><strong>House and world data</strong>These account details are not connected to the launcher yet. This blade shows live access and launch status only.</p><span className="hub-server"><i />{activeGame?.status || 'Status unavailable'}</span></div>
        </div>}
        summary={<div className="hub-roster"><div className="hub-character"><span className="hub-character-initial">D</span><div><strong>Dominion access</strong><small>{accessLabel}</small></div></div></div>}
      >
        <section className="aethro-online-layout">
          <div className="panel">
            <div className="panel-heading"><h2>Your Dominion</h2><span>{home.user.displayName}</span></div>
            <div className="identity-box">
              <span className="eyebrow">Aethro account</span>
              <strong>{accessLabel}</strong>
              <p>{canPlayDominion
                ? 'Play opens Dominion in its own launcher window with a short-lived, single-use handoff. Your launcher login is never placed in the URL.'
                : 'Dominion closed-beta eligibility is checked against the Aethro account currently signed into this launcher.'}</p>
            </div>
            <div className="kalismor-panel-actions">
              <button className="secondary compact-button" onClick={() => void loadDominionAccess()} disabled={dominionAccessLoading || dominionLaunching}>
                {dominionAccessLoading ? 'Checking…' : 'Refresh access'}
              </button>
              <button className="secondary compact-button" onClick={() => void openExternal('https://dominion.playaethro.online/')}>
                Open in external browser
              </button>
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
      <GameHub key="kalismor" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={aethroOnlineNews} staffAccess={gameStaffAccess('aethro-online')} staffPanel={renderLinkedStaffPanel('aethro-online', 'KALISMOR', 'Manage Aethro Online access, stats, and skills.')} onOpenStaff={() => document.querySelector<HTMLButtonElement>('.hub-staff-rail button')?.focus()}
        onHome={returnToLauncherHome} library={renderGameLibrary()} downloads={<div className="hub-download-empty"><strong>Kalismor does not require a separate client download.</strong><p>Connect using the selected character and the launcher’s built-in terminal or external-client handoff.</p></div>} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
        primary={{ label: startingKalismor ? 'Connecting…' : 'Enter Kalismor', disabled: startingKalismor || !selectedKalismorCharacter, action: () => { void startKalismorLogin(); } }}
        status={selectedKalismorCharacter ? `Playing as ${selectedKalismorCharacter.name}` : 'Choose a character in Account & setup'}
        music={renderHubMusic()} notice={<>{renderLauncherUpdateNotice()}{kalismorError && <p className="error">{kalismorError}</p>}</>}
        overview={(navigate) => <div className="blade-kalismor-overview"><section className="blade-kalismor-select"><div className="blade-card-heading"><h2>Choose your character</h2><button onClick={() => void loadKalismorCharacters()} disabled={kalismorLoading}>{kalismorLoading ? 'Refreshing…' : 'Refresh'}</button></div><div className="blade-character-list">{kalismorLoading && !kalismorCharactersLoaded ? <p>Loading characters…</p> : kalismorCharacters.length ? kalismorCharacters.map(character => <button type="button" aria-pressed={selectedKalismorCharacterId === character.id} className="blade-character-row" key={character.id} onClick={() => setSelectedKalismorCharacterId(character.id)}><span className="blade-char-crest">{character.name.slice(0, 1).toUpperCase()}</span><span className="blade-character-name"><strong>{character.name}</strong><small>{character.race || 'Chronicles'} · {character.className || 'Adventurer'}{character.level ? ` · Level ${character.level}` : ''}</small></span><span className="blade-last-active"><strong>{character.location || 'Kalismor'}</strong><small>{character.lastPlayedAt ? `Last active ${formatDate(character.lastPlayedAt)}` : 'Ready to adventure'}</small></span><i className="blade-online-dot" /></button>) : <p>No characters yet. Create your first Chronicles character in Settings.</p>}</div></section><div className="blade-kalismor-actions"><button className="blade-kalismor-action" onClick={() => navigate('settings')}><strong>Create character</strong><small>Open character setup</small></button><button className="blade-kalismor-action" onClick={() => void openExternal(AETHRO_ONLINE_FORUMS_URL)}><strong>Character journal</strong><small>Visit the Kalismor community</small></button><div className="blade-kalismor-action blade-kalismor-world"><strong><span className="blade-check">●</span> World {activeGame?.status || 'status unavailable'}</strong><small>Aethro Online realm status</small></div></div></div>}
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
      <GameHub key="shadows" game={activeGame!} player={home.user.displayName} avatarUrl={home.user.avatarUrl} news={shadowsNews} staffAccess={gameStaffAccess('shadows-of-aethro')} staffPanel={renderLinkedStaffPanel('shadows-of-aethro', 'SHADOWS OF AETHRO', 'Manage player lookup, store delivery resends, and queued server actions.')} onOpenStaff={() => document.querySelector<HTMLButtonElement>('.hub-staff-rail button')?.focus()}
        onHome={returnToLauncherHome} library={renderGameLibrary()} downloads={<div className="hub-downloads-content"><article className="hub-download-item"><div><span className="hub-kicker">SHADOWS OF AETHRO</span><h3>{ready ? 'Up to date' : installState === 'checking' ? 'Checking files' : modpackCheck ? 'Update available' : installState === 'failed' ? 'Setup needs attention' : 'Not installed'}</h3><p>{repairProgress?.message || progressDetail}</p></div><div className="hub-download-progress"><div className="blade-progress-track"><span style={{ width: `${progressPercent}%` }} /></div><div className="blade-progress-label"><span>{repairProgress?.currentFile || (modpackCheck ? `${modpackCheck.okFiles}/${modpackCheck.totalFiles} files verified` : statusMessage)}</span><strong>{progressPercent}%</strong></div></div><div className="hub-download-actions"><button className="secondary" onClick={() => void verifyShadowsFiles()} disabled={checkingFiles || repairingFiles}>{checkingFiles ? 'Checking…' : 'Check files'}</button><button onClick={() => void repairShadowsFiles()} disabled={checkingFiles || repairingFiles}>{repairingFiles ? 'Installing…' : ready ? 'Repair files' : 'Install / update'}</button></div></article></div>} openExternal={openExternal} showDetails={showDetails} onDetails={() => setShowDetails(value => !value)}
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

  const homeGames = home.games.filter((game) => game.id !== 'reforged' && game.id !== 'shadows');
  const homeNews = news.filter((item) => item.feedId !== 'shadows-of-aethro').slice(0, 3);
  const artForNews = (feedId: string) => feedId === 'aethro-online'
    ? '/images/game-kalismor-home.png'
    : feedId === 'dominion'
      ? '/images/game-dominion-home.png'
      : '/images/game-reforged-home.png';

  return (
    <main className="dashboard home-dashboard reference-home">
      <aside className="launcher-sidebar">
        <button className="launcher-wordmark" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>PLAY AETHRO</button>
        <nav className="launcher-nav" aria-label="Launcher navigation">
          <button className={homeNavigation === 'home' ? 'active' : ''} onClick={() => { setHomeNavigation('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><HomeIcon size={17} />Home</button>
          <button className={homeNavigation === 'games' ? 'active' : ''} onClick={() => { setHomeNavigation('games'); homeGamesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}><Gamepad2 size={17} />Games</button>
          <button onClick={() => openHomeHubTab('library')}><LibraryIcon size={17} />Library</button>
          <button onClick={() => openHomeHubTab('downloads')}><DownloadIcon size={17} />Downloads</button>
          <button onClick={() => setView('launcher-settings')}><SettingsIcon size={17} />Settings</button>
        </nav>
      </aside>

      <div className="launcher-home-stage">
        <header className="launcher-home-topbar">
          <div className="launcher-home-links">
            <button onClick={() => openExternal(home.links.website)}>Website <ArrowUpRight size={13} /></button>
            <button onClick={() => openExternal(home.links.discord)}>Discord <ArrowUpRight size={13} /></button>
            <button className="launcher-logout" onClick={onLogout}>Log out</button>
          </div>
          <div className="reference-account"><span className="home-avatar">{home.user.avatarUrl ? <img src={home.user.avatarUrl} alt="" /> : accountInitial}</span><span>{home.user.displayName}</span></div>
          <div className="launcher-home-music">{renderHubMusic()}</div>
        </header>

        {renderLauncherUpdateNotice()}

        <section className="launcher-feature-hero" aria-label="Aethro Reforged" style={{ backgroundImage: "linear-gradient(90deg,rgba(3,8,13,.78),rgba(3,8,13,.12) 65%,rgba(3,8,13,.05)),linear-gradient(0deg,rgba(3,8,13,.75),transparent 55%),url('/images/game-reforged-home.png')" }}>
          <div className="launcher-feature-copy">
            <h1><span>Aethro</span><small>Reforged</small></h1>
            <p>A broken world. A brighter tomorrow.</p>
            <button onClick={() => playGame('reforged')}><span className="button-icon icon-play" aria-hidden="true" />Play</button>
          </div>
        </section>

        <section className="launcher-home-overview" aria-label="Your characters and realms">
          <div className="launcher-home-panel launcher-world-status">
            <div className="launcher-home-panel-heading"><h2>Realm status</h2></div>
            {home.games.map(game => <div className="launcher-realm-row" key={game.id}><span className={`launcher-realm-dot server-${game.status}`} /><strong>{game.id === 'aethro-online' ? 'Kalismor' : game.title}</strong><span>{game.status === 'unknown' ? 'Status unavailable' : game.status[0].toUpperCase() + game.status.slice(1)}</span></div>)}
          </div>
          <div className="launcher-home-panel launcher-home-roster">
            <div className="launcher-home-panel-heading"><h2>Your characters</h2><button onClick={() => openHomeGame('reforged')}>Reforged roster →</button></div>
            {reforgedProfileLoading && <p>Loading your roster…</p>}
            {!reforgedProfileLoading && reforgedProfile?.characters.length ? <div className="launcher-character-grid">{reforgedProfile.characters.slice(0, 4).map(character => <button key={character.id} onClick={() => openHomeGame('reforged')}><span>{character.name.slice(0, 1).toUpperCase()}</span><strong>{character.name}</strong><small>Level {character.level} · {character.online ? 'Online' : 'Offline'}</small></button>)}</div> : !reforgedProfileLoading && <p>{reforgedProfile?.charactersAvailable ? 'No Reforged characters yet.' : 'Your Reforged roster will appear here when it’s available.'}</p>}
            {kalismorCharacters.length > 0 && <div className="launcher-home-secondary-roster"><strong>Kalismor</strong><span>{kalismorCharacters.slice(0, 3).map(character => `${character.name} · Lv. ${character.level || '?'}`).join('  /  ')}</span></div>}
            <button className="launcher-account-link" onClick={() => void openExternal(PLAY_AETHRO_ACCOUNT_REFORGED_URL)}>{reforgedProfile?.account.username ? `Reforged account · ${reforgedProfile.account.username}` : 'Manage Reforged account'} <ArrowUpRight size={13} /></button>
          </div>
        </section>

        <section className="launcher-game-tiles" ref={homeGamesRef} aria-label="More Aethro games">
          {homeGames.map((game) => (
            <button key={game.id} className={`launcher-game-tile ${worldCardClass(game.id)}`} onClick={() => openHomeGame(game.id)} style={{ backgroundImage: `linear-gradient(0deg,rgba(3,8,13,.88),rgba(3,8,13,.05) 78%),url('${artForNews(game.id)}')` }}>
              <span>{game.id === 'aethro-online' ? 'Kalismor' : game.title}</span>
            </button>
          ))}
        </section>

          <section className="launcher-news-section">
          <div className="launcher-news-heading"><h2>From Aethro</h2><button onClick={() => openHomeHubTab('news')}>View all <ArrowUpRight size={13} /></button></div>
          {homeNews.length ? (
            <div className="launcher-news-grid">
              {homeNews.map((item) => (
                <button className="launcher-news-card" key={item.id} onClick={() => openExternal(item.url)}>
                  <span className="launcher-news-art" style={{ backgroundImage: `url('${artForNews(item.feedId)}')` }} />
                  <span className="launcher-news-copy"><strong>{item.title}</strong><span>{item.summary}</span><small>{formatDate(item.publishedAt)}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="launcher-news-empty">Aethro announcements will appear here when they’re available.</p>}
        </section>
      </div>
    </main>
  );
}
