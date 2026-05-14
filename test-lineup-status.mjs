import fetch from 'node-fetch';

const today = new Date().toISOString().split('T')[0];
const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=lineups,probablePitcher`;
const res = await fetch(url);
const data = await res.json();
const games = data.dates?.[0]?.games || [];
console.log(`Games today (${today}):`, games.length);
let confirmedLineups = 0;
games.forEach(g => {
  const awayLineup = g.lineups?.awayPlayers?.length || 0;
  const homeLineup = g.lineups?.homePlayers?.length || 0;
  const awayPitcher = g.teams?.away?.probablePitcher?.fullName || 'TBD';
  const homePitcher = g.teams?.home?.probablePitcher?.fullName || 'TBD';
  const gameTime = g.gameDate;
  const hasLineup = awayLineup > 0 || homeLineup > 0;
  if (hasLineup) confirmedLineups++;
  console.log(`${g.teams.away.team.name} @ ${g.teams.home.team.name} | ${gameTime} | away=${awayLineup} home=${homeLineup} | ${awayPitcher} vs ${homePitcher}`);
});
console.log(`\nConfirmed lineups: ${confirmedLineups}/${games.length} games`);
console.log(`Probable pitchers available: ${games.filter(g => g.teams?.away?.probablePitcher || g.teams?.home?.probablePitcher).length}/${games.length} games`);
