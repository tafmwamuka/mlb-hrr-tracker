import fetch from 'node-fetch';

const resp = await fetch('https://www.ballparkpal.com/MatchUps.php');
const html = await resp.text();
const match = html.match(/__matchupExportData\s*=\s*(\[[\s\S]*?\]);/);
if (!match) { console.log('No data found'); process.exit(1); }
const data = JSON.parse(match[1]);
const starters = data.filter(p => p['Starter'] == 1);
const vs10 = starters.filter(p => p['vs Grade'] == 10);
const vs9 = starters.filter(p => p['vs Grade'] == 9);
console.log('VS=10 names:', vs10.map(p => p['Name']));
console.log('VS=9 names:', vs9.map(p => p['Name']));
