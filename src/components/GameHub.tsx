import { useState, type ReactNode } from 'react';
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.js';
import Bell from 'lucide-react/dist/esm/icons/bell.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Gamepad2 from 'lucide-react/dist/esm/icons/gamepad-2.js';
import Home from 'lucide-react/dist/esm/icons/home.js';
import Library from 'lucide-react/dist/esm/icons/library.js';
import Newspaper from 'lucide-react/dist/esm/icons/newspaper.js';
import Play from 'lucide-react/dist/esm/icons/play.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import type { LauncherGame, LauncherNewsItem } from '../lib/types';
import './game-hub.css';

export type HubTab = 'games' | 'library' | 'downloads' | 'settings' | 'news';
type Props = {
  game: LauncherGame;
  player: string;
  avatarUrl?: string;
  news: LauncherNewsItem[];
  initialTab?: HubTab;
  reforgedMacMode?: boolean;
  staffAccess?: boolean;
  staffPanel?: ReactNode;
  onOpenStaff?: () => void;
  onHome: () => void;
  openExternal: (url: string) => Promise<void>;
  primary: { label: string; disabled?: boolean; tab?: HubTab; action: () => void };
  status: string;
  notice?: ReactNode;
  music?: ReactNode;
  summary?: ReactNode;
  overview?: ReactNode | ((navigate: (tab: HubTab) => void) => ReactNode);
  library?: ReactNode;
  downloads?: ReactNode;
  children: ReactNode;
  showDetails: boolean;
  onDetails: () => void;
};

const themes: Record<string, { image: string; title: string; tagline: string }> = {
  reforged: { image: '/images/game-reforged-home.png', title: 'Aethro: Reforged', tagline: 'A Broken World. A Brighter Tomorrow.' },
  shadows: { image: '/images/game-shadows-home.png', title: 'Shadows of Aethro', tagline: 'Explore the wilds. Build a home. Find your next adventure.' },
  'aethro-online': { image: '/images/game-kalismor-home.png', title: 'Kalismor', tagline: 'Choose your path.' },
  dominion: { image: '/images/game-dominion-home.png', title: 'Dominion', tagline: 'Rule what you build.' }
};
const tabs = [
  { id: 'games', label: 'Games', Icon: Gamepad2 },
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'downloads', label: 'Downloads', Icon: Download },
  { id: 'settings', label: 'Settings', Icon: Settings }
] as const;

export function GameHub({ game, player, avatarUrl, news, initialTab, reforgedMacMode = false, staffAccess = false, staffPanel, onOpenStaff, onHome, openExternal, primary, status, notice, music, summary, overview, library, downloads, children, showDetails, onDetails }: Props) {
  const [tab, setTab] = useState<HubTab>(initialTab ?? 'games');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [staffOpen, setStaffOpen] = useState(true);
  const theme = themes[game.id] ?? themes.reforged;
  const links = game.links;
  function newsList(limit: number) {
    return news.length ? news.slice(0, limit).map(item => (
      <button className="hub-story" key={item.id} onClick={() => void openExternal(item.url)}>
        <span className="hub-story-art" style={{ backgroundImage: `url(${theme.image})` }} />
        <span><small>{item.source === 'forum' ? 'Community forums' : item.feedName}</small><strong>{item.title}</strong><span className="hub-story-summary">{item.summary}</span></span>
        <ArrowUpRight size={16} />
      </button>
    )) : <div className="hub-empty"><Newspaper size={25} /><h3>No updates loaded yet</h3><p>Game announcements will appear here when available.</p></div>;
  }
  const gameOverview = typeof overview === 'function' ? overview(setTab) : overview;

  return (
    <main className={`game-window hub-${game.id}${reforgedMacMode ? ' hub-reforged-mac' : ''}${staffAccess && staffOpen ? ' hub-has-staff' : ''}`} data-hub-tab={reforgedMacMode ? tab : undefined}>
      <div className="hub-layout">
        <aside className="hub-sidebar">
          <button className="hub-brand" onClick={onHome}><span>Play Aethro</span></button>
          <nav className="hub-global-nav" aria-label="Launcher navigation">
            <button className="hub-nav-home" onClick={onHome}><Home size={18} />Home</button>
            <div className="hub-nav-rule" />
            <div className="hub-tabs" role="tablist" aria-label={`${game.title} sections`}>
              {tabs.map(({ id, label, Icon }) => <button key={id} id={`hub-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`hub-panel-${id}`} tabIndex={tab === id ? 0 : -1}
                onKeyDown={event => { const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0; if (!direction) return; event.preventDefault(); const next = tabs[(tabs.findIndex(t => t.id === id) + direction + tabs.length) % tabs.length].id; setTab(next); document.getElementById(`hub-tab-${next}`)?.focus(); }}
                onClick={() => setTab(id)}><Icon size={18} />{id === 'settings' && game.id === 'reforged' ? 'Client settings' : label}</button>)}
            </div>
          </nav>
          <div className="hub-sidebar-footer"><span className={`hub-server server-${game.status}`}><i />{game.status}</span>{game.premium?.status === 'active' && <span className="hub-premium">♛ Premium active</span>}</div>
        </aside>
        <div className="hub-stage">
          <header className="hub-header">
            <div className="hub-header-links">
              {links?.forum && <button onClick={() => void openExternal(links.forum!)}>Community <ArrowUpRight size={13} /></button>}
              {links?.vote && <button onClick={() => void openExternal(links.vote!)}>Vote <ArrowUpRight size={13} /></button>}
              {links?.shop && <button onClick={() => void openExternal(links.shop!)}><ShoppingBag size={14} /> Shop</button>}
              {game.premium?.url && <button onClick={() => void openExternal(game.premium!.url!)}>Premium <ArrowUpRight size={13} /></button>}
            </div>
            <div className="hub-header-account">
              {music}
              <button className={`hub-updates${news.length ? ' has-updates' : ''}`} title="Game updates" aria-label="Game updates" aria-pressed={tab === 'news'} onClick={() => setTab('news')}><Bell size={17} />{news.length > 0 && <i />}</button>
              {avatarUrl && !avatarFailed ? <img className="hub-player-avatar" src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : <span className="hub-player-fallback" aria-hidden="true">{player.slice(0, 1).toUpperCase()}</span>}
              <span className="hub-player" title={player}>{player}</span>
              {staffAccess && <button className="hub-staff-shortcut" aria-expanded={staffOpen} onClick={() => { const opening = !staffOpen; setStaffOpen(opening); if (opening) window.requestAnimationFrame(() => onOpenStaff?.()); }}>Staff</button>}
            </div>
          </header>
          <div className="hub-stage-content">
          <div className="hub-main">
          <section className="hub-hero" style={{ backgroundImage: `linear-gradient(90deg, #030912e8 0%, #040a1275 47%, #050a1210 100%), linear-gradient(0deg,#050a12a8,transparent 38%), url(${theme.image})` }}>
            <div className="hub-hero-copy"><h1 className={`hub-title-${game.id}`}>{game.id === 'reforged' ? <><span>Aethro</span><small>Reforged</small></> : theme.title}</h1><p>{theme.tagline}</p>
              <button className="hub-launch" disabled={primary.disabled} onClick={() => { if (primary.tab) setTab(primary.tab); primary.action(); }}>{reforgedMacMode ? <><span>{primary.label}</span><ChevronRight size={25} strokeWidth={2.4} /></> : <><Play size={20} fill="currentColor" /><span>{primary.label}</span></>}</button>
            </div>
            <span className="hub-hero-status"><i className={`server-${game.status}`} />{status}</span>
          </section>
          {notice && <div className="hub-notice" role="status">{notice}</div>}
          <div className="hub-body">
            <section role="tabpanel" id="hub-panel-games" aria-labelledby="hub-tab-games" hidden={tab !== 'games'} className="hub-game-content">
              {gameOverview ?? <div className="hub-overview"><div className="hub-panel"><div className="hub-panel-heading"><h2>Latest news</h2><button onClick={() => setTab('news')}>View updates →</button></div>{newsList(3)}</div><div className="hub-panel"><div className="hub-panel-heading"><h2>Your adventure</h2><button onClick={() => setTab('settings')}>Manage →</button></div>{summary ?? <p>Select Settings to prepare your game.</p>}</div></div>}
            </section>
            <section role="tabpanel" id="hub-panel-library" aria-labelledby="hub-tab-library" hidden={tab !== 'library'} className="hub-panel hub-library"><div className="hub-panel-heading"><h2>Game Library</h2></div>{library ?? <p>Your games will appear here.</p>}</section>
            <section role="tabpanel" id="hub-panel-downloads" aria-labelledby="hub-tab-downloads" hidden={tab !== 'downloads'} className="hub-panel hub-downloads"><div className="hub-panel-heading"><h2>Downloads</h2></div>{downloads ?? <p>No game downloads are required right now.</p>}</section>
            <section role="tabpanel" id="hub-panel-settings" aria-labelledby="hub-tab-settings" hidden={tab !== 'settings'} className="hub-settings"><div className="hub-panel-heading"><h2>{game.id === 'reforged' ? 'Client settings' : 'Game settings'}</h2><button className="hub-details-toggle" aria-pressed={showDetails} onClick={onDetails}>{showDetails ? 'Hide file details' : 'Show file details'}</button></div>{children}</section>
            <section role="tabpanel" id="hub-panel-news" aria-label={`${game.title} updates`} hidden={tab !== 'news'} className="hub-panel hub-news"><h2>{game.title} updates</h2>{newsList(30)}</section>
          </div>
          </div>
          {staffAccess && staffPanel && staffOpen && <aside className="hub-staff-rail" aria-label={`${game.title} staff controls`}><button className="hub-staff-close" aria-label="Close staff controls" title="Close staff controls" onClick={() => setStaffOpen(false)}><X size={17} /></button>{staffPanel}</aside>}
          </div>
        </div>
      </div>
    </main>
  );
}
