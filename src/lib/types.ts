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
export type LauncherNewsSource = 'official' | 'forum';

export type LauncherNewsItem = {
  id: string;
  feedId: NewsFeedId;
  feedName: string;
  title: string;
  summary: string;
  publishedAt: string;
  url: string;
  /** Forum announcements and editorial news render together, but stay visibly attributed. */
  source?: LauncherNewsSource;
};

export type GamePremium = {
  status: 'active' | 'available' | 'unavailable';
  label?: string;
  url?: string;
};

export type GameLinks = {
  website?: string;
  forum?: string;
  vote?: string;
  shop?: string;
};

export type GameMusic = {
  label: string;
  tracks: Array<{ title: string; src: string }>;
};

export type LauncherGame = {
  id: 'shadows' | 'aethro-online' | 'reforged' | 'dominion' | string;
  title: string;
  description: string;
  status: 'online' | 'offline' | 'maintenance' | 'unknown';
  /** Round-trip connection time to the game's status endpoint, in milliseconds. */
  pingMs?: number;
  actionLabel: string;
  feedId?: NewsFeedId;
  accent?: 'shadows' | 'kalismor' | 'reforged' | 'dominion';
  premium?: GamePremium;
  links?: GameLinks;
  music?: GameMusic;
};

export type LauncherGameStatus = {
  status: LauncherGame['status'];
  pingMs?: number;
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

export type ReforgedMacRuntime = {
  supported: boolean;
  appleSilicon: boolean;
  appInstalled: boolean;
  appVersion?: string;
  shortcutExportSupported: boolean;
  appPath?: string;
  launchShortcut?: string;
  launchShortcutName?: string;
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
  manifestSha256?: string;
  installDir: string;
  totalFiles: number;
  okFiles: number;
  missingFiles: number;
  changedFiles: number;
  invalidManifestFiles: number;
  ready: boolean;
  files: ModpackFileStatus[];
};

export type ReforgedLaunchPreparation = {
  manifestSha256?: string;
  ready: boolean;
  missingCriticalFiles: number;
};

export type ReforgedManifestUpdate = {
  manifestSha256?: string;
  updateAvailable: boolean;
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

/** The launcher only needs the eligibility result; account identity stays with Aethro OAuth. */
export type DominionAccess = {
  enabled: boolean;
  access: 'staff' | 'tester' | 'public' | 'denied' | string;
};

/** A short-lived, single-use browser destination issued by Play Aethro. */
export type DominionLaunchHandoff = {
  launchUrl: string;
  expiresAt?: string;
};

export type LauncherStaffGameAccess = {
  label: string;
  access: boolean;
  controlUrl: string;
  actions?: { broadcast: boolean; kick: boolean; mute: boolean };
};

export type LauncherStaffAccess = { games: Record<string, LauncherStaffGameAccess> };
export type LauncherStaffPlayer = { id: number; name: string; level: number };
export type LauncherStaffAuditEntry = {
  action: string;
  target: string | null;
  message: string;
  result: 'success' | 'failed' | string;
  created_at: string;
};
export type LauncherStaffAction =
  | { action: 'broadcast'; message: string }
  | { action: 'kick'; character_id: number; reason: string }
  | { action: 'mute'; character_id: number; minutes: number; reason: string };
