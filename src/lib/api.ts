import { invoke } from '@tauri-apps/api/core';
import type {
  AuthSession,
  LauncherHome,
  LauncherNewsItem,
  LocalMinecraftProfile,
  ModpackCheckResult,
  NewsFeedId,
  UserProfile
} from './types';

const API_BASE = 'https://aethro.net/api';
const SESSION_STORAGE_KEY = 'aethro.launcher.session.v1';
const USERINFO_TIMEOUT_MS = 8_000;
const RSS_TIMEOUT_MS = 8_000;

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

function isProbablyExpired(session: AuthSession): boolean {
  if (!session.expiresAt) return false;
  return Date.parse(session.expiresAt) <= Date.now() + 30_000;
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

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
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
      config: {
        clientId: OAUTH_CONFIG.clientId,
        clientSecret: OAUTH_CONFIG.clientSecret,
        redirectUri: OAUTH_CONFIG.redirectUri,
        scope: OAUTH_CONFIG.scope,
        usePkce: OAUTH_CONFIG.usePkce,
        tokenAuthMethod: OAUTH_CONFIG.tokenAuthMethod,
        authorizeUrl: OAUTH_CONFIG.authorizeUrl,
        tokenUrl: OAUTH_CONFIG.tokenUrl,
        userinfoUrl: OAUTH_CONFIG.userinfoUrl
      }
    });

    if (remember) saveSession(session);
    return session;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err || 'Aethro login failed.'));
  }
}

export async function refreshSession(session: AuthSession): Promise<AuthSession | null> {
  // If Aethro returns refresh tokens, we can wire them here later. For now,
  // keep the saved token and validate it by calling userinfo during boot.
  if (!isProbablyExpired(session)) return session;
  return session.refreshToken ? session : null;
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

export async function detectLocalMinecraftProfile(): Promise<LocalMinecraftProfile | null> {
  return invoke<LocalMinecraftProfile | null>('detect_local_minecraft_profile');
}

export async function openMinecraftLauncher(): Promise<string> {
  return invoke<string>('open_minecraft_launcher');
}

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
  const [newsResult, userResult] = await Promise.allSettled([
    getLauncherNews(),
    getCurrentUser(session)
  ]);

  const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
  const user = userResult.status === 'fulfilled'
    ? userResult.value
    : session.user ?? {
      id: 'aethro-user',
      displayName: 'Aethro Hero'
    };

  if (newsResult.status === 'rejected') console.warn('Launcher news failed to load.', newsResult.reason);
  if (userResult.status === 'rejected') console.warn('Aethro profile refresh failed.', userResult.reason);

  return createLauncherHome(user, news);
}

export function createLauncherHome(user: UserProfile, news: LauncherNewsItem[] = []): LauncherHome {
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
        status: 'unknown',
        actionLabel: 'Play Shadows'
      },
      {
        id: 'aethro-online',
        title: 'Chronicles of Kalismor',
        description: 'A dark fantasy MUD gateway being prepared.',
        status: 'maintenance',
        actionLabel: 'View Kalismor'
      }
    ],
    links: {
      website: 'https://playaethro.online',
      discord: 'https://dsc.gg/aethro'
    }
  };
}
