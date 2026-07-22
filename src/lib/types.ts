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

export type NewsFeedId = 'play-aethro' | 'aethro-online' | 'shadows';

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
  id: 'shadows' | 'aethro-online' | string;
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
