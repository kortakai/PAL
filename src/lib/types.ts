export type UserProfile = {
  id: string;
  displayName: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
  minecraftName?: string;
  minecraftUuid?: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  user?: UserProfile;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  user: UserProfile;
};

export type NewsFeedId = 'play-aethro-launcher' | 'aethro-online' | 'aethro-reforged' | 'shadows-of-aethro';

export type LauncherNewsItem = {
  id: string;
  feedId: NewsFeedId;
  feedName: string;
  title: string;
  summary: string;
  publishedAt: string;
  url: string;
};

export type LauncherGame = {
  id: 'shadows' | 'aethro-online' | 'reforged' | string;
  title: string;
  description: string;
  status: 'online' | 'offline' | 'maintenance' | 'unknown';
  actionLabel: string;
};

export type LauncherHome = {
  user: UserProfile;
  hero: {
    imageUrl: string;
    title: string;
    subtitle: string;
  };
  news: LauncherNewsItem[];
  games: LauncherGame[];
  links: {
    website: string;
    discord: string;
  };
};

export type ModpackFileStatus = {
  path: string;
  status: 'ok' | 'missing' | 'changed' | 'invalidManifest';
  expectedSha256?: string;
  actualSha256?: string;
  sizeBytes?: number;
};

export type LocalMinecraftProfile = {
  name: string;
  uuid?: string;
  source: string;
};

export type LocalReforgedAccount = {
  installDir?: string;
  isClientInstalled: boolean;
  accountName?: string;
  source?: string;
  configPath?: string;
  message?: string;
};

export type ReforgedServerAccount = {
  exists: boolean;
  username: string;
  passwordSet: boolean;
  azerothcoreAccountId?: number;
  syncedAt?: string;
  lastPasswordChangedAt?: string;
};

export type ReforgedCharacter = {
  id: string;
  name: string;
  level: number;
  raceId?: number;
  classId?: number;
  genderId?: number;
  zoneId?: number;
  mapId?: number;
  online?: boolean;
  lastPlayedAt?: string;
  playTimeSeconds?: number;
};

export type ReforgedProfile = {
  account: ReforgedServerAccount;
  characters: ReforgedCharacter[];
  charactersAvailable: boolean;
};

export type ShadowsRepairProgress = {
  phase: 'checking' | 'installing' | 'setup' | 'verifying' | 'ready' | 'needsUpdate' | 'failed';
  message: string;
  currentFile?: string;
  currentIndex: number;
  totalFiles: number;
  downloadedBytes: number;
  totalBytes: number;
};

export type ModpackCheckResult = {
  gameId: string;
  displayName: string;
  channel: string;
  installDir: string;
  totalFiles: number;
  okFiles: number;
  missingFiles: number;
  changedFiles: number;
  invalidManifestFiles: number;
  ready: boolean;
  files: ModpackFileStatus[];
};

export type KalismorCharacter = {
  id: string;
  name: string;
  level?: number;
  className?: string;
  race?: string;
  location?: string;
  lastPlayedAt?: string;
};

export type KalismorLoginToken = {
  token: string;
  expiresAt?: string;
  host?: string;
  port?: number;
  websocketUrl?: string;
  launchUrl?: string;
};
