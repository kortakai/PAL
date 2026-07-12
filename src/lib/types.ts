export type UserProfile = {
  id: string;
  displayName: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
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
