import 'dotenv/config';

const email = process.env.BALLPARK_EMAIL;
const password = process.env.BALLPARK_PASSWORD;

// Try different login endpoints
const endpoints = [
  'https://www.ballparkpal.com/api/auth/login',
  'https://ballparkpal.com/api/auth/login',
  'https://www.ballparkpal.com/login',
  'https://ballparkpal.com/login',
  'https://www.ballpark.com/login',
];

for (const url of endpoints) {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });
    console.log(`${url}: ${resp.status} ${resp.headers.get('location') || ''}`);
    if (resp.status < 400) {
      const text = await resp.text();
      console.log('  Body:', text.slice(0, 200));
    }
  } catch (e) {
    console.log(`${url}: ERROR ${e.message}`);
  }
}

// Try fetching the main page to understand the site structure
try {
  const resp = await fetch('https://www.ballparkpal.com/', { redirect: 'manual' });
  console.log('\nMain page status:', resp.status);
  console.log('Location:', resp.headers.get('location'));
  if (resp.ok) {
    const html = await resp.text();
    console.log('Title:', html.match(/<title>(.*?)<\/title>/)?.[1]);
    console.log('Has login form:', html.includes('login') || html.includes('sign-in'));
  }
} catch (e) {
  console.log('Main page error:', e.message);
}

// Try ballparkpal.com matchup page
try {
  const resp = await fetch('https://www.ballparkpal.com/MatchUps.php', { redirect: 'manual' });
  console.log('\nMatchUps page status:', resp.status);
  if (resp.ok) {
    const html = await resp.text();
    console.log('Has VS column:', html.includes('VS') || html.includes('vs'));
    console.log('Sample:', html.slice(0, 500));
  }
} catch (e) {
  console.log('MatchUps error:', e.message);
}
