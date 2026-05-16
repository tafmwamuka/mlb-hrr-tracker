import { config } from 'dotenv';
config();

const key = process.env.ODDS_API_KEY;
console.log('Key present:', !!key, key ? `(${key.slice(0,8)}...)` : '');

try {
  const resp = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${key}&regions=us&markets=totals&oddsFormat=american`);
  console.log('Status:', resp.status);
  const text = await resp.text();
  console.log('Response preview:', text.slice(0, 300));
} catch (e) {
  console.log('Fetch error:', e.message);
}
