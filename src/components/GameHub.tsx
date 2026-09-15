import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Home, Newspaper, Settings, ShoppingBag, Users, Play } from 'lucide-react';
import type { LauncherGame, LauncherNewsItem } from '../lib/types';
import './game-hub.css';

type Props = {
  game: LauncherGame;
  player: string;
  avatarUrl?: string;
  news: LauncherNewsItem[];
  onHome: () => void;
  openExternal: (url: string) => Promise<void>;
  primary: { label: string; disabled?: boolean; action: () => void };
  status: string;
  notice?: ReactNode;
  music?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  showDetails: boolean;
  onDetails: () => void;
};

const themes: Record<string, { image: string; kicker: string; description: string }> = {
  reforged: { image: '/images/game-reforged-home.png', kicker: 'Aethro: Reforged', description: 'Return to the realm. Your next adventure is waiting.' },
  shadows: { image: '/images/game-shadows-home.png', kicker: 'Shadows of Aethro', description: 'Explore the wilds. Build a home. Find your next adventure.' },
  'aethro-online': { image: '/images/game-kalismor-home.png', kicker: 'Aethro Online', description: 'Choose your character and step into Kalismor.' }
};
const tabs = [
  { id: 'overview', label: 'Overview', Icon: Home },
  { id: 'news', label: 'News', Icon: Newspaper },
  { id: 'community', label: 'Community', Icon: Users },
  { id: 'shop', label: 'Shop', Icon: ShoppingBag },
  { id: 'setup', label: 'Account & setup', Icon: Settings }
] as const;
type Tab = typeof tabs[number]['id'];

export function GameHub({ game, player, avatarUrl, news, onHome, openExternal, primary, status, notice, music, summary, children, showDetails, onDetails }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const theme = themes[game.id] ?? themes.reforged;
  const links = game.links;
  function newsList(limit: number) {
    return news.length ? news.slice(0, limit).map(item => (
      <button className="hub-story" key={item.id} onClick={() => void openExternal(item.url)}>
        <span className="hub-story-art" style={{ backgroundImage: `url(${theme.image})` }} />
        <span><small>{item.source === 'forum' ? 'From the forums' : item.feedName}</small><strong>{item.title}</strong><span className="hub-story-summary">{item.summary}</span></span>
        <ArrowUpRight size={16} />
      </button>
    )) : <div className="hub-empty"><Newspaper size={28} /><h3>No updates loaded yet</h3><p>Game announcements will appear here when available.</p></div>;
  }
  return (
    <main className={`game-window hub-${game.id}`}>
      <header className="hub-header">
        <button className="hub-brand" onClick={onHome}><span>PA</span>Play Aethro Launcher</button>
        <button className="hub-back" onClick={onHome}><ArrowLeft size={16} /> Home</button>
        <span className="hub-header-title">{game.title}</span>
        <span className="hub-player" title={player}>
          {avatarUrl && !avatarFailed ? <img className="hub-player-avatar" src={avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : <span className="hub-player-fallback" aria-hidden="true">{player.slice(0, 1).toUpperCase()}</span>}
          <span>{player}</span>
        </span>
      </header>
      <div className="hub-service-bar">
        <span className={`hub-server server-${game.status}`}><i />{game.status}</span>
        {game.premium?.status === 'active' && <span className="hub-premium">♛ Premium active</span>}
        <div className="hub-shortcuts">
          {links?.vote && <button onClick={() => void openExternal(links.vote!)}>Vote <ArrowUpRight size={14} /></button>}
          {game.premium?.url && <button onClick={() => void openExternal(game.premium!.url!)}>Premium <ArrowUpRight size={14} /></button>}
          {music}
        </div>
      </div>
      <section className="hub-hero" style={{ backgroundImage: `linear-gradient(90deg, #050a12eb, #050a1270 47%, #050a1210), url(${theme.image})` }}>
        <div className="hub-hero-copy"><span className="hub-kicker">{theme.kicker}</span><h1>{game.title}</h1><p>{theme.description}</p></div>
        <div className="hub-launch-strip">
          <button className="hub-launch" disabled={primary.disabled} onClick={primary.action}><Play size={23} fill="currentColor" />{primary.label}</button>
          <span className="hub-launch-status">{status}</span>
          <button className="hub-settings-link" onClick={() => setTab('setup')}><Settings size={16} /> Account & setup</button>
        </div>
      </section>
      {notice && <div className="hub-notice" role="status">{notice}</div>}
      <nav className="hub-tabs" role="tablist" aria-label={`${game.title} sections`}>
        {tabs.map(({ id, label, Icon }) => <button key={id} id={`hub-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`hub-panel-${id}`} tabIndex={tab === id ? 0 : -1}
          onKeyDown={event => { const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0; if (!direction) return; event.preventDefault(); const next = tabs[(tabs.findIndex(t => t.id === id) + direction + tabs.length) % tabs.length].id; setTab(next); document.getElementById(`hub-tab-${next}`)?.focus(); }}
          onClick={() => setTab(id)}><Icon size={20} />{label}</button>)}
      </nav>
      <div className="hub-body">
        <section role="tabpanel" id="hub-panel-overview" aria-labelledby="hub-tab-overview" hidden={tab !== 'overview'} className="hub-overview">
          <div className="hub-panel"><div className="hub-panel-heading"><h2>Latest news</h2><button onClick={() => setTab('news')}>View all →</button></div>{newsList(3)}</div>
          <div className="hub-panel"><div className="hub-panel-heading"><h2>Your adventure</h2><button onClick={() => setTab('setup')}>Manage →</button></div>{summary ?? <p>Select Account & setup to prepare your game.</p>}</div>
        </section>
        <section role="tabpanel" id="hub-panel-news" aria-labelledby="hub-tab-news" hidden={tab !== 'news'} className="hub-panel"><h2>{game.title} news</h2>{newsList(30)}</section>
        <section role="tabpanel" id="hub-panel-community" aria-labelledby="hub-tab-community" hidden={tab !== 'community'} className="hub-panel hub-destination"><Users size={36} /><h2>Meet your community</h2><p>Read announcements, share your adventures, and join the conversation.</p>{links?.forum ? <button onClick={() => void openExternal(links.forum!)}>Open forums <ArrowUpRight size={16} /></button> : <p>Community links are not available for this game yet.</p>}</section>
        <section role="tabpanel" id="hub-panel-shop" aria-labelledby="hub-tab-shop" hidden={tab !== 'shop'} className="hub-panel hub-destination"><ShoppingBag size={36} /><h2>The game shop</h2><p>Browse the available items and rewards on the game website.</p>{links?.shop ? <button onClick={() => void openExternal(links.shop!)}>Open shop <ArrowUpRight size={16} /></button> : <p>The shop is not available for this game yet.</p>}{links?.vote && <button onClick={() => void openExternal(links.vote!)}>Vote & rewards <ArrowUpRight size={16} /></button>}</section>
        <section role="tabpanel" id="hub-panel-setup" aria-labelledby="hub-tab-setup" hidden={tab !== 'setup'}><button className="hub-details-toggle" aria-pressed={showDetails} onClick={onDetails}>{showDetails ? 'Hide file details' : 'Show file details'}</button>{children}</section>
      </div>
    </main>
  );
}
