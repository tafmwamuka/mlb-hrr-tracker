import fs from 'fs';

// Fetch the Cheat Sheets page from ballparkpal.com
const pages = [
  'https://www.ballparkpal.com/CheatSheets.php',
  'https://www.ballparkpal.com/Cheatsheets.php',
  'https://www.ballparkpal.com/cheatsheets.php',
  'https://www.ballparkpal.com/cheat-sheets.php',
  'https://www.ballparkpal.com/GameTotals.php',
  'https://www.ballparkpal.com/Totals.php',
];

for (const url of pages) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MLBHRRTracker/1.0)' }
    });
    console.log(`${url}: ${resp.status}`);
    if (resp.ok) {
      const html = await resp.text();
      // Look for JSON data variables
      const varMatches = html.match(/var __\w+ = /g);
      if (varMatches) console.log('  Data vars:', varMatches);
      
      // Look for game total data
      const exportMatch = html.match(/var __\w+ExportData = (\[[\s\S]*?\]);/);
      if (exportMatch) {
        const data = JSON.parse(exportMatch[1]);
        console.log('  Export data entries:', data.length);
        console.log('  Fields:', Object.keys(data[0]).join(', '));
        console.log('  Sample:', JSON.stringify(data[0]).slice(0, 400));
        fs.writeFileSync('/tmp/cheatsheet.html', html);
        console.log('  Saved to /tmp/cheatsheet.html');
      }
      
      // Look for total/over-under keywords
      if (html.includes('Total') || html.includes('O/U') || html.includes('over') || html.includes('under')) {
        console.log('  Has total/over-under content');
        // Find the context
        const idx = html.indexOf('Total');
        if (idx > 0) console.log('  Context:', html.slice(Math.max(0, idx-50), idx+200).replace(/\s+/g, ' '));
      }
      
      // Save the page for inspection
      if (!fs.existsSync('/tmp/cheatsheet.html')) {
        fs.writeFileSync('/tmp/cheatsheet.html', html);
      }
    }
  } catch (e) {
    console.log(`${url}: ERROR ${e.message}`);
  }
}
