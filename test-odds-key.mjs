import 'dotenv/config';

const key = process.env.ODDS_API_KEY;
console.log('Key present:', !!key, key ? key.substring(0, 8) + '...' : 'none');

if (!key) {
  console.log('No ODDS_API_KEY set');
  process.exit(1);
}

try {
  const res = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${key}`);
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.substring(0, 300));
} catch (e) {
  console.log('Error:', e.message);
}
