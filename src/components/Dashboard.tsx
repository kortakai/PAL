import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { LauncherHome, NewsFeedId } from '../lib/types';

type Props = {
  home: LauncherHome;
  onLogout: () => void;
};

const FEED_TABS: Array<{ id: 'all' | NewsFeedId; label: string }> = [
  { id: 'all', label: 'All News' },
  { id: 'play-aethro', label: 'Play Aethro' },
  { id: 'aethro-online', label: 'Aethro Online' },
  { id: 'shadows', label: 'Shadows' }
];

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso));
}

export function Dashboard({ home, onLogout }: Props) {
  const [activeFeed, setActiveFeed] = useState<'all' | NewsFeedId>('all');

  async function openExternal(url: string) {
    await openUrl(url);
  }

  function playGame(gameId: string) {
    // TODO: route to Shadows patcher or Aethro Online character picker/terminal.
    alert(`${gameId} launcher flow not wired yet.`);
  }

  const visibleNews = useMemo(() => {
    if (activeFeed === 'all') return home.news;
    return home.news.filter((item) => item.feedId === activeFeed);
  }, [activeFeed, home.news]);

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <span className="eyebrow">Play Aethro Launcher</span>
          <h1>Welcome back, {home.user.displayName}</h1>
        </div>
        <button className="secondary" onClick={onLogout}>Log out</button>
      </header>

      <section className="wide-hero">
        <div>
          <h2>{home.hero.title}</h2>
          <p>{home.hero.subtitle}</p>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-heading">
            <h2>News</h2>
            <span>{visibleNews.length} article{visibleNews.length === 1 ? '' : 's'}</span>
          </div>

          <div className="feed-tabs">
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

          <div className="news-list">
            {visibleNews.length === 0 ? (
              <article className="news-item">
                <h3>No news loaded</h3>
                <p>The RSS feed did not return articles yet. Check the feed URL or network connection.</p>
              </article>
            ) : visibleNews.map((item) => (
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

        <div className="panel">
          <h2>Play</h2>
          <div className="game-list">
            {home.games.map((game) => (
              <article key={game.id} className="game-card">
                <div>
                  <h3>{game.title}</h3>
                  <p>{game.description}</p>
                  <span className={`status ${game.status}`}>{game.status}</span>
                </div>
                <button onClick={() => playGame(game.id)}>{game.actionLabel}</button>
              </article>
            ))}
          </div>
          <div className="external-row">
            <button className="secondary" onClick={() => openExternal(home.links.website)}>Open Website</button>
            <button className="secondary" onClick={() => openExternal(home.links.discord)}>Open Discord</button>
          </div>
        </div>
      </section>
    </main>
  );
}
