import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('./node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js');

const CHROMIUM_PATH = '/usr/bin/chromium';
const COOKIES = [
  { name: 'PHPSESSID', value: 'pt837eh3d3p71qjvroela6dnp1', domain: 'www.ballparkpal.com', path: '/' },
  { name: 'system_id', value: '6a05bebe8802c9.72739147', domain: 'www.ballparkpal.com', path: '/' },
];

async function fetchBallparkPal() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setCookie(...COOKIES);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Navigating to ballparkpal...');
    await page.goto('https://www.ballparkpal.com/MatchUps.php', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    const hasData = await page.evaluate(() => {
      return typeof window.__matchupExportData !== 'undefined' && window.__matchupExportData.length > 0;
    });
    
    if (hasData) {
      const data = await page.evaluate(() => window.__matchupExportData);
      console.log(`SUCCESS: Got ${data.length} matchups`);
      console.log('First player:', JSON.stringify(data[0]).substring(0, 300));
    } else {
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log('FAILED: No data found');
      console.log('Page title:', title);
      console.log('Body text:', bodyText);
    }
  } finally {
    await browser.close();
  }
}

fetchBallparkPal().catch(console.error);
