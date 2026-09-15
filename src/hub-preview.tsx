// Local visual QA entry. This is not an authentication path or the desktop app entry.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameHub } from './components/GameHub';
import type { LauncherGame } from './lib/types';
import './styles.css';
const games: LauncherGame[] = [
  { id:'reforged', title:'Aethro: Reforged', status:'unknown', actionLabel:'Play', feedId:'aethro-reforged' },
  { id:'shadows', title:'Shadows of Aethro', status:'unknown', actionLabel:'Play', feedId:'shadows-of-aethro' },
  { id:'aethro-online', title:'Chronicles of Kalismor', status:'unknown', actionLabel:'Play', feedId:'aethro-online' }
].map(game => ({ ...game, description:'Design preview', status:'unknown' as const } as LauncherGame));
function Preview() {
  const [index,setIndex]=useState(0);
  const [details,setDetails]=useState(false);
  const game=games[index];
  return <GameHub key={game.id} game={game} player="Design preview" avatarUrl="/images/launcher-home-citadel.png" news={[]} onHome={()=>setIndex((index+1)%games.length)} openExternal={async()=>{}} primary={{label:'Preview only',disabled:true,action:()=>{}}} status="No live account or game connection" showDetails={details} onDetails={()=>setDetails(!details)} summary={<p>Use Home to preview the next game. Account data is not loaded in this design preview.</p>}><div className="panel"><h2>Account & setup</h2><p>Setup controls appear here in the desktop launcher.</p>{details && <p>Expanded details preview</p>}</div></GameHub>;
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />);
