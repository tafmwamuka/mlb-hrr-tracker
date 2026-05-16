// Test MLB Stats API game log fetch for Bobby Witt Jr. (playerId 677951)
const playerId = 677951;
const season = new Date().getFullYear();
const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&season=${season}&group=hitting`;

console.log('Fetching:', url);
try {
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  console.log('Status:', res.status);
  const json = await res.json();
  const splits = json.stats?.[0]?.splits ?? [];
  console.log('Total game log entries:', splits.length);
  const last7 = splits.slice(-7).reverse();
  console.log('Last 7 games:');
  for (const s of last7) {
    console.log(`  ${s.date}: H=${s.stat?.hits} R=${s.stat?.runs} RBI=${s.stat?.rbi} AB=${s.stat?.atBats}`);
  }
} catch (e) {
  console.log('Error:', e.message, e.cause?.code);
}
