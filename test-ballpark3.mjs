import 'dotenv/config';

// Fetch the MatchUps page and look for the VS rating data structure
try {
  const resp = await fetch('https://www.ballparkpal.com/MatchUps.php');
  const html = await resp.text();
  
  // Look for table headers and VS column
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/g);
  console.log('Tables found:', tableMatch?.length || 0);
  
  // Look for data in script tags (often JSON data)
  const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const script of scriptMatches) {
    if (script.includes('VS') || script.includes('matchup') || script.includes('batter') || script.includes('pitcher')) {
      if (!script.includes('gtm') && !script.includes('google') && !script.includes('analytics')) {
        console.log('\nRelevant script found:', script.slice(0, 1000));
      }
    }
  }
  
  // Look for the actual matchup data table
  const vsIndex = html.indexOf('VS');
  if (vsIndex > 0) {
    console.log('\nContext around VS:', html.slice(Math.max(0, vsIndex - 200), vsIndex + 500));
  }
  
  // Check if it requires login
  if (html.includes('login') || html.includes('sign in') || html.includes('subscribe')) {
    console.log('\nLogin/subscribe references found');
    const loginSection = html.match(/login|sign.?in|subscribe/gi);
    console.log('Count:', loginSection?.length);
  }
  
  // Look for RC and matchup data
  const rcMatch = html.indexOf('RC');
  if (rcMatch > 0) {
    console.log('\nContext around RC:', html.slice(Math.max(0, rcMatch - 100), rcMatch + 300));
  }
  
  // Save full HTML for inspection
  const fs = await import('fs');
  fs.writeFileSync('/tmp/matchups.html', html);
  console.log('\nFull HTML saved to /tmp/matchups.html, size:', html.length);
  
} catch (e) {
  console.log('Error:', e.message);
}
