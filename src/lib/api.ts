import { invoke } from '@tauri-apps/api/core';
import type {
  AuthSession,
  LauncherGame,
  LauncherHome,
  LauncherNewsItem,
  KalismorCharacter,
  KalismorLoginToken,
  LocalMinecraftProfile,
  LocalReforgedAccount,
  ModpackCheckResult,
  NewsFeedId,
  ReforgedCharacter,
  ReforgedProfile,
  ReforgedServerAccount,
  UserProfile
} from './types';

const API_BASE = 'https://aethro.net/api';
const PLAY_AETHRO_API_BASE = 'https://playaethro.online/api';
const AETHRO_ONLINE_API_BASE = 'https://aethro.online/api';
const SESSION_STORAGE_KEY = 'aethro.launcher.session.v1';
const USERINFO_TIMEOUT_MS = 8_000;
const RSS_TIMEOUT_MS = 8_000;
const KALISMOR_TIMEOUT_MS = 10_000;
const REFORGED_TIMEOUT_MS = 10_000;
const KALISMOR_PUBLIC_MUD_PORT = 25_000;
const SHADOWS_LAUNCH_EVENT_URL = `${PLAY_AETHRO_API_BASE}/account/game-launches`;
const REFORGED_PROFILE_URL = `${PLAY_AETHRO_API_BASE}/account/games/aethro-reforged`;

const GAME_SERVER_STATUS_TARGETS = [
  { id: 'shadows', host: 'mc.aethro.net', port: 25_567 },
  { id: 'reforged', host: 'aethro.net', port: 3_724 }
] as const;

const OAUTH_CONFIG = {
  clientId: 'ath_XuN_R2q4KK7VUFDYvGiksCgx',
  clientSecret: 'athsec_db__ZuF10cjW6foS_7EVjdxY45-bdHJA1tl4PLQZUo830Prm',
  redirectUri: 'http://127.0.0.1:38987/oauth/callback',
  scope: 'openid profile discord',
  usePkce: false,
  tokenAuthMethod: 'clientSecretPost',
  authorizeUrl: 'https://aethro.net/oauth/authorize/',
  tokenUrl: 'https://aethro.net/oauth/token/',
  userinfoUrl: 'https://aethro.net/api/account/userinfo/',
  discordGuildsUrl: 'https://aethro.net/api/account/discord-guilds/',
  logoutUrl: 'https://aethro.net/oauth/logout/'
};

const RSS_FEEDS: Array<{ id: NewsFeedId; name: string; url: string }> = [
  {
    id: 'play-aethro',
    name: 'Play Aethro',
    url: 'https://aethro.net/rss.php?division=play-aethro'
  },
  {
    id: 'aethro-online',
    name: 'Aethro Online',
    url: 'https://aethro.net/rss.php?division=aethro-online'
  },
  {
    id: 'shadows',
    name: 'Shadows of Aethro',
    url: 'https://aethro.net/rss.php?division=minecraft-survival'
  }
];

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
};

type ShadowsLaunchProof = {
  game: 'shadows-of-aethro';
  minecraft_uuid: string;
  minecraft_username: string;
  launched_at: string;
};

type MudTerminalOutput = {
  sessionId: string;
  data: string;
};

function stringFrom(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

function sessionExpiryMs(session: AuthSession): number | null {
  if (!session.expiresAt) return null;
  if (session.expiresAt.startsWith('unix:')) {
    const seconds = Number(session.expiresAt.slice(5));
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }

  const parsed = Date.parse(session.expiresAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProbablyExpired(session: AuthSession): boolean {
  const expiresAt = sessionExpiryMs(session);
  if (expiresAt === null) return false;
  return expiresAt <= Date.now() + 30_000;
}

export function isAuthRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return /401|unauthorized|invalid.*token|token.*invalid|expired/i.test(message);
}

function oauthInvokeConfig() {
  return {
    clientId: OAUTH_CONFIG.clientId,
    clientSecret: OAUTH_CONFIG.clientSecret,
    redirectUri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scope,
    usePkce: OAUTH_CONFIG.usePkce,
    tokenAuthMethod: OAUTH_CONFIG.tokenAuthMethod,
    authorizeUrl: OAUTH_CONFIG.authorizeUrl,
    tokenUrl: OAUTH_CONFIG.tokenUrl,
    userinfoUrl: OAUTH_CONFIG.userinfoUrl
  };
}

export function loadSavedSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken) return null;

    // Older dev builds created fake sessions named "Aethro Hero".
    // Do not keep those once real OAuth is wired.
    if (session.accessToken.startsWith('dev-session-token-')) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    if (isProbablyExpired(session) && !session.refreshToken) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSavedSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function apiRequestUrl<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  return invoke<T>('api_request_json', {
    url,
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body)
  });
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return apiRequestUrl<T>(`${API_BASE}${path}`, options);
}

async function aethroOnlineRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return withTimeout(
    apiRequestUrl<T>(`${AETHRO_ONLINE_API_BASE}${path}`, options),
    KALISMOR_TIMEOUT_MS,
    'Kalismor API'
  );
}

function devSession(identifier: string): AuthSession {
  const displayName = identifier.includes('@') ? identifier.split('@')[0] : identifier;
  return {
    accessToken: `dev-session-token-${Date.now()}`,
    refreshToken: `dev-refresh-token-${Date.now()}`,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    user: {
      id: 'dev-user',
      username: displayName,
      displayName: displayName || 'Aethro Hero'
    }
  };
}

export async function loginWithAethro(remember: boolean): Promise<AuthSession> {
  try {
    const session = await invoke<AuthSession>('oauth_login', {
      config: oauthInvokeConfig()
    });

    if (remember) saveSession(session);
    return session;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err || 'Aethro login failed.'));
  }
}

export async function refreshAethroSession(session: AuthSession): Promise<AuthSession | null> {
  if (session.accessToken.startsWith('dev-session-token-')) return session;
  if (!session.refreshToken) return null;

  try {
    const refreshed = await invoke<AuthSession>('oauth_refresh', {
      config: oauthInvokeConfig(),
      refreshToken: session.refreshToken
    });

    const nextSession: AuthSession = {
      ...refreshed,
      refreshToken: refreshed.refreshToken || session.refreshToken,
      user: {
        ...(session.user ?? { id: 'aethro-user', displayName: 'Aethro Hero' }),
        ...(refreshed.user ?? {}),
        displayName: refreshed.user?.displayName || session.user?.displayName || 'Aethro Hero'
      }
    };

    saveSession(nextSession);
    return nextSession;
  } catch (err) {
    console.warn('Aethro token refresh failed.', err);
    return null;
  }
}

export async function refreshSession(session: AuthSession): Promise<AuthSession | null> {
  if (!isProbablyExpired(session)) return session;
  return refreshAethroSession(session);
}

export async function runWithFreshAethroSession<T>(
  session: AuthSession,
  onSessionUpdated: (session: AuthSession) => void,
  action: (session: AuthSession) => Promise<T>
): Promise<T> {
  const refreshedBeforeRequest = isProbablyExpired(session) ? await refreshAethroSession(session) : null;
  const activeSession = refreshedBeforeRequest ?? session;
  if (refreshedBeforeRequest) onSessionUpdated(refreshedBeforeRequest);

  try {
    return await action(activeSession);
  } catch (err) {
    if (!isAuthRejection(err)) throw err;

    const refreshedAfterRejection = await refreshAethroSession(activeSession);
    if (!refreshedAfterRejection) throw err;

    onSessionUpdated(refreshedAfterRejection);
    return action(refreshedAfterRejection);
  }
}

export async function getCurrentUser(session: AuthSession): Promise<UserProfile> {
  if (session.user && session.accessToken.startsWith('dev-session-token-')) return session.user;

  try {
    const userInfo = await withTimeout(
      invoke<UserProfile>('api_request_json', {
        url: OAUTH_CONFIG.userinfoUrl,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`
        },
        body: null
      }),
      USERINFO_TIMEOUT_MS,
      'Aethro user info'
    );

    return {
      ...session.user,
      ...userInfo,
      displayName: userInfo.displayName || userInfo.username || session.user?.displayName || 'Aethro Hero'
    };
  } catch (err) {
    if (isAuthRejection(err)) {
      throw err instanceof Error ? err : new Error(String(err || 'Aethro session expired.'));
    }
    if (session.user) return session.user;
    throw err instanceof Error ? err : new Error(String(err || 'Unable to load account profile.'));
  }
}

export async function logoutSession(session: AuthSession): Promise<void> {
  clearSavedSession();

  if (session.accessToken.startsWith('dev-session-token-')) return;

  try {
    await invoke('api_request_json', {
      url: OAUTH_CONFIG.logoutUrl,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`
      },
      body: null
    });
  } catch (err) {
    console.warn('Remote logout failed; local session was cleared.', err);
  }
}

export async function beginDiscordLogin(remember: boolean): Promise<AuthSession> {
  // Aethro already owns the login system. This uses the same OAuth flow;
  // users can choose Discord on the Aethro login page if enabled there.
  return loginWithAethro(remember);
}

export async function checkShadowsInstall(): Promise<ModpackCheckResult> {
  return invoke<ModpackCheckResult>('check_shadows_install');
}

export async function repairShadowsInstall(): Promise<ModpackCheckResult> {
  return invoke<ModpackCheckResult>('repair_shadows_install');
}

export async function checkReforgedInstall(): Promise<ModpackCheckResult> {
  return invoke<ModpackCheckResult>('check_reforged_install');
}

export async function repairReforgedInstall(): Promise<ModpackCheckResult> {
  return invoke<ModpackCheckResult>('repair_reforged_install');
}

export async function detectLocalMinecraftProfile(): Promise<LocalMinecraftProfile | null> {
  return invoke<LocalMinecraftProfile | null>('detect_local_minecraft_profile');
}

export async function detectLocalReforgedAccount(): Promise<LocalReforgedAccount | null> {
  return invoke<LocalReforgedAccount | null>('detect_local_reforged_account');
}

export async function setReforgedInstallDir(installDir: string): Promise<LocalReforgedAccount> {
  return invoke<LocalReforgedAccount>('set_reforged_install_dir', {
    installDir
  });
}

export async function openMinecraftLauncher(): Promise<string> {
  return invoke<string>('open_minecraft_launcher');
}

export async function openReforgedClient(): Promise<string> {
  return invoke<string>('open_reforged_client');
}

export async function recordShadowsLaunch(session: AuthSession, minecraft: LocalMinecraftProfile): Promise<void> {
  if (!minecraft.uuid || !minecraft.name) {
    throw new Error('A verified Minecraft username and UUID are required before launching Shadows.');
  }

  const payload: ShadowsLaunchProof = {
    game: 'shadows-of-aethro',
    minecraft_uuid: minecraft.uuid,
    minecraft_username: minecraft.name,
    launched_at: new Date().toISOString()
  };

  await apiRequestUrl<unknown>(SHADOWS_LAUNCH_EVENT_URL, {
    method: 'POST',
    token: session.accessToken,
    body: payload
  });
}

function normalizeKalismorCharacter(raw: unknown): KalismorCharacter | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = stringFrom(item.id ?? item.character_id ?? item.characterId);
  const name = stringFrom(item.name ?? item.character_name ?? item.characterName);
  if (!id || !name) return null;

  return {
    id,
    name,
    level: numberFrom(item.level),
    className: stringFrom(item.class ?? item.class_name ?? item.className),
    race: stringFrom(item.race),
    location: stringFrom(item.location),
    lastPlayedAt: stringFrom(item.last_played_at ?? item.lastPlayedAt)
  };
}

function normalizeKalismorCharacters(response: unknown): KalismorCharacter[] {
  const candidate = Array.isArray(response)
    ? response
    : response && typeof response === 'object'
      ? (response as Record<string, unknown>).characters ?? (response as Record<string, unknown>).data
      : [];

  return Array.isArray(candidate)
    ? candidate.map(normalizeKalismorCharacter).filter((character): character is KalismorCharacter => Boolean(character))
    : [];
}

function normalizeKalismorMudPort(host: string | undefined, port: unknown): number | undefined {
  const normalizedHost = host?.trim().toLowerCase();
  if (normalizedHost === 'aethro.online' || normalizedHost === 'www.aethro.online') {
    return KALISMOR_PUBLIC_MUD_PORT;
  }

  return numberFrom(port);
}

function normalizeReforgedAccount(raw: unknown): ReforgedServerAccount {
  const account = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const username = stringFrom(account.username ?? account.account_name ?? account.accountName);

  return {
    exists: Boolean(account.exists),
    username: username || 'Not created yet',
    passwordSet: Boolean(account.passwordSet ?? account.password_set),
    azerothcoreAccountId: numberFrom(account.azerothcoreAccountId ?? account.azerothcore_account_id),
    syncedAt: stringFrom(account.syncedAt ?? account.synced_at),
    lastPasswordChangedAt: stringFrom(account.lastPasswordChangedAt ?? account.last_password_changed_at)
  };
}

function normalizeReforgedCharacter(raw: unknown): ReforgedCharacter | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = stringFrom(item.id ?? item.guid ?? item.character_id ?? item.characterId);
  const name = stringFrom(item.name ?? item.character_name ?? item.characterName);
  if (!id || !name) return null;

  return {
    id,
    name,
    level: numberFrom(item.level) ?? 1,
    raceId: numberFrom(item.raceId ?? item.race_id ?? item.race),
    classId: numberFrom(item.classId ?? item.class_id ?? item.class),
    genderId: numberFrom(item.genderId ?? item.gender_id ?? item.gender),
    zoneId: numberFrom(item.zoneId ?? item.zone_id ?? item.zone),
    mapId: numberFrom(item.mapId ?? item.map_id ?? item.map),
    online: typeof item.online === 'boolean' ? item.online : Boolean(numberFrom(item.online)),
    lastPlayedAt: stringFrom(item.lastPlayedAt ?? item.last_played_at),
    playTimeSeconds: numberFrom(item.playTimeSeconds ?? item.play_time_seconds ?? item.totaltime)
  };
}

function normalizeReforgedProfile(response: unknown): ReforgedProfile {
  const candidate = response && typeof response === 'object'
    ? (response as Record<string, unknown>).data && typeof (response as Record<string, unknown>).data === 'object'
      ? (response as Record<string, unknown>).data as Record<string, unknown>
      : response as Record<string, unknown>
    : {};
  const rawCharacters = Array.isArray(candidate.characters) ? candidate.characters : [];

  return {
    account: normalizeReforgedAccount(candidate.account),
    characters: rawCharacters
      .map(normalizeReforgedCharacter)
      .filter((character): character is ReforgedCharacter => Boolean(character)),
    charactersAvailable: (candidate.charactersAvailable ?? candidate.characters_available) === undefined
      ? true
      : Boolean(candidate.charactersAvailable ?? candidate.characters_available)
  };
}

function normalizeKalismorLoginToken(response: unknown): KalismorLoginToken {
  const candidate = response && typeof response === 'object'
    ? (response as Record<string, unknown>).token && typeof (response as Record<string, unknown>).token === 'object'
      ? (response as Record<string, unknown>).token as Record<string, unknown>
      : response as Record<string, unknown>
    : {};

  const token = stringFrom(candidate.token ?? candidate.login_token ?? candidate.loginToken ?? candidate.value);
  if (!token) throw new Error('Kalismor did not return a login token.');
  const host = stringFrom(candidate.host);

  return {
    token,
    expiresAt: stringFrom(candidate.expires_at ?? candidate.expiresAt),
    host,
    port: normalizeKalismorMudPort(host, candidate.port),
    websocketUrl: stringFrom(candidate.websocket_url ?? candidate.websocketUrl ?? candidate.ws_url ?? candidate.wsUrl),
    launchUrl: stringFrom(candidate.launch_url ?? candidate.launchUrl)
  };
}

export async function getKalismorCharacters(session: AuthSession): Promise<KalismorCharacter[]> {
  const response = await aethroOnlineRequest<unknown>('/mud/characters', {
    token: session.accessToken
  });
  return normalizeKalismorCharacters(response);
}

export async function getReforgedProfile(session: AuthSession): Promise<ReforgedProfile> {
  const response = await withTimeout(
    apiRequestUrl<unknown>(REFORGED_PROFILE_URL, {
      token: session.accessToken
    }),
    REFORGED_TIMEOUT_MS,
    'Aethro: Reforged account'
  );

  return normalizeReforgedProfile(response);
}

export async function createKalismorCharacter(session: AuthSession, name: string): Promise<KalismorCharacter> {
  const response = await aethroOnlineRequest<unknown>('/mud/characters', {
    method: 'POST',
    token: session.accessToken,
    body: { name }
  });
  const character = normalizeKalismorCharacter(
    response && typeof response === 'object'
      ? (response as Record<string, unknown>).character ?? (response as Record<string, unknown>).data ?? response
      : response
  );
  if (!character) throw new Error('Kalismor did not return the created character.');
  return character;
}

export async function requestKalismorLoginToken(session: AuthSession, characterId: string): Promise<KalismorLoginToken> {
  const response = await aethroOnlineRequest<unknown>(`/mud/characters/${encodeURIComponent(characterId)}/token`, {
    method: 'POST',
    token: session.accessToken
  });
  return normalizeKalismorLoginToken(response);
}

export async function connectMudTerminal(
  token: KalismorLoginToken,
  characterName: string
): Promise<string> {
  if (!token.host || !token.port) {
    throw new Error('Kalismor did not return a terminal host and port.');
  }

  const response = await invoke<{ sessionId: string }>('mud_terminal_connect', {
    request: {
      host: token.host,
      port: token.port,
      token: token.token,
      characterName
    }
  });

  return response.sessionId;
}

export async function sendMudTerminalInput(sessionId: string, data: string): Promise<void> {
  await invoke('mud_terminal_send', {
    sessionId,
    data
  });
}

export async function disconnectMudTerminal(sessionId: string): Promise<void> {
  await invoke('mud_terminal_disconnect', {
    sessionId
  });
}

function normalizeGameServerStatus(value: unknown): LauncherGame['status'] {
  return value === 'online' ? 'online' : 'offline';
}

export async function getGameServerStatuses(): Promise<Partial<Record<LauncherGame['id'], LauncherGame['status']>>> {
  const settled = await Promise.allSettled(
    GAME_SERVER_STATUS_TARGETS.map(async (target) => ({
      id: target.id,
      status: normalizeGameServerStatus(await invoke<string>('check_game_server_status', {
        host: target.host,
        port: target.port
      }))
    }))
  );

  return settled.reduce<Partial<Record<LauncherGame['id'], LauncherGame['status']>>>((statuses, result, index) => {
    const target = GAME_SERVER_STATUS_TARGETS[index];
    statuses[target.id] = result.status === 'fulfilled' ? result.value.status : 'offline';
    return statuses;
  }, {});
}

export type { MudTerminalOutput };

async function fetchText(url: string): Promise<string> {
  // Rust-side request avoids browser CORS problems inside the Tauri webview.
  return withTimeout(invoke<string>('fetch_text', { url }), RSS_TIMEOUT_MS, 'Aethro RSS feed');
}

function textFromElement(parent: Element, tagName: string): string {
  return parent.querySelector(tagName)?.textContent?.trim() ?? '';
}

function stripHtml(input: string): string {
  const doc = new DOMParser().parseFromString(input, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseRss(xml: string, feedId: NewsFeedId, feedName: string): LauncherNewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = doc.querySelector('parsererror');

  if (parserError) {
    throw new Error(`Unable to parse ${feedName} RSS feed.`);
  }

  return [...doc.querySelectorAll('item')].slice(0, 8).map((item, index) => {
    const title = textFromElement(item, 'title') || 'Untitled';
    const url = textFromElement(item, 'link') || 'https://playaethro.online';
    const publishedAtRaw = textFromElement(item, 'pubDate');
    const description = textFromElement(item, 'description');
    const summary = stripHtml(description).slice(0, 220);
    const publishedAt = publishedAtRaw ? new Date(publishedAtRaw).toISOString() : new Date().toISOString();

    return {
      id: `${feedId}-${publishedAt}-${index}`,
      feedId,
      feedName,
      title,
      summary: summary || 'Open the article for details.',
      publishedAt,
      url
    };
  });
}

export async function getLauncherNews(): Promise<LauncherNewsItem[]> {
  const settled = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      console.info(`Loading ${feed.name} RSS`, feed.url);
      return parseRss(await fetchText(feed.url), feed.id, feed.name);
    })
  );

  const news = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;

    console.warn(`RSS feed failed: ${RSS_FEEDS[index].name}`, result.reason);
    return [];
  });

  return news.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function getLauncherHome(session: AuthSession): Promise<LauncherHome> {
  const [newsResult, userResult, serverStatusResult] = await Promise.allSettled([
    getLauncherNews(),
    getCurrentUser(session),
    getGameServerStatuses()
  ]);

  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
  const gameStatuses = serverStatusResult.status === 'fulfilled' ? serverStatusResult.value : {};
  if (userResult.status === 'rejected' && isAuthRejection(userResult.reason)) {
    throw userResult.reason instanceof Error
      ? userResult.reason
      : new Error(String(userResult.reason || 'Aethro session expired.'));
  }

  const user = userResult.status === 'fulfilled'
    ? userResult.value
    : session.user ?? {
      id: 'aethro-user',
      displayName: 'Aethro Hero'
    };

  if (newsResult.status === 'rejected') console.warn('Launcher news failed to load.', newsResult.reason);
  if (userResult.status === 'rejected') console.warn('Aethro profile refresh failed.', userResult.reason);
  if (serverStatusResult.status === 'rejected') console.warn('Game server status failed to load.', serverStatusResult.reason);

  return createLauncherHome(user, news, gameStatuses);
}

export function createLauncherHome(
  user: UserProfile,
  news: LauncherNewsItem[] = [],
  gameStatuses: Partial<Record<LauncherGame['id'], LauncherGame['status']>> = {}
): LauncherHome {
  return {
    user,
    hero: {
      imageUrl: '/hero-card-placeholder.svg',
      title: 'Play Aethro',
      subtitle: 'Choose your world.'
    },
    news,
    games: [
      {
        id: 'shadows',
        title: 'Shadows of Aethro',
        description: 'Fabric 1.21.1 modded Minecraft adventure.',
        status: gameStatuses.shadows ?? 'offline',
        actionLabel: 'Play Shadows'
      },
      {
        id: 'aethro-online',
        title: 'Chronicles of Kalismor',
        description: 'A dark fantasy MUD gateway being prepared.',
        status: 'maintenance',
        actionLabel: 'View Kalismor'
      },
      {
        id: 'reforged',
        title: 'Aethro: Reforged',
        description: 'Connect with your own WoW 3.3.5a client.',
        status: gameStatuses.reforged ?? 'offline',
        actionLabel: 'Play Reforged'
      }
    ],
    links: {
      website: 'https://playaethro.online',
      discord: 'https://dsc.gg/aethro'
    }
  };
}
