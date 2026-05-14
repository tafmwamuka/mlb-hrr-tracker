import fs from 'fs';

const html = fs.readFileSync('/tmp/matchups.html', 'utf8');
const match = html.match(/var __matchupExportData = (\[[\s\S]*?\]);/);
const data = JSON.parse(match[1]);

// Group by game and sum RC to estimate game total
const gameRCs = {};
data.filter(d => d.Starter === 1).forEach(d => {
  const game = d.Game.trim();
  if (!gameRCs[game]) gameRCs[game] = { total: 0, count: 0, players: [] };
  gameRCs[game].total += d.RC;
  gameRCs[game].count++;
  gameRCs[game].players.push({ name: d.Batter, rc: d.RC, team: d.Team.trim(), vsGrade: d['vs Grade'] });
});

console.log('Games with aggregate RC (proxy for projected game total):');
Object.entries(gameRCs).sort((a, b) => b[1].total - a[1].total).forEach(([game, data]) => {
  const avgRC = (data.total / data.count).toFixed(1);
  console.log(`  ${game}: RC sum=${data.total}, players=${data.count}, avg RC=${avgRC}`);
});

// The sum of RC for all starters in a game is a reasonable proxy for projected game total
// Higher total RC = more runs expected = higher game total
// We can use this as our "game total influence" factor
console.log('\n--- Game Total Influence Logic ---');
console.log('Sum of RC per game correlates with expected run production.');
console.log('Games with higher total RC should boost player picks (more scoring environment).');
