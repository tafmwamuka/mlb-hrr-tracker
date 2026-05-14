import 'dotenv/config';

const email = process.env.BALLPARK_EMAIL;
const password = process.env.BALLPARK_PASSWORD;
console.log('Email set:', !!email);
console.log('Password set:', !!password);

if (!email || !password) {
  console.log('Missing credentials, exiting');
  process.exit(0);
}

// Try to login and fetch matchup data
try {
  const loginResp = await fetch('https://www.ballpark.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  console.log('Login status:', loginResp.status);
  
  if (loginResp.ok) {
    const loginData = await loginResp.json();
    console.log('Login response keys:', Object.keys(loginData));
    const token = loginData.token || loginData.access_token;
    
    if (token) {
      // Try to fetch matchups
      const matchupResp = await fetch('https://www.ballpark.com/api/matchups/today', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      console.log('Matchups status:', matchupResp.status);
      if (matchupResp.ok) {
        const matchupData = await matchupResp.json();
        console.log('Matchup data type:', typeof matchupData);
        console.log('Matchup data sample:', JSON.stringify(matchupData).slice(0, 500));
      } else {
        const text = await matchupResp.text();
        console.log('Matchups error:', text.slice(0, 300));
      }
      
      // Also try /api/matchups or /api/batters-vs-pitchers
      for (const endpoint of ['/api/matchups', '/api/bvp', '/api/batters-vs-pitchers', '/api/picks', '/api/plays']) {
        try {
          const resp = await fetch(`https://www.ballpark.com${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          console.log(`${endpoint}: ${resp.status}`);
          if (resp.ok) {
            const data = await resp.json();
            console.log(`  Sample:`, JSON.stringify(data).slice(0, 200));
          }
        } catch (e) {
          console.log(`${endpoint}: error`, e.message);
        }
      }
    }
  } else {
    const text = await loginResp.text();
    console.log('Login error:', text.slice(0, 300));
  }
} catch (error) {
  console.log('Error:', error.message);
}
