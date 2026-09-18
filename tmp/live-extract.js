const { chromium } = require('playwright');

async function scrapeCognizant() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
  const url = 'https://careers.cognizant.com/global-en/jobs/';
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(8000);
  const jobs = await page.evaluate(() => {
    const results = [];
    const cards = Array.from(document.querySelectorAll('.card.card-job'));
    cards.forEach((card) => {
      const anchor = card.querySelector('a.stretched-link.js-view-job');
      const title = card.querySelector('.card-title')?.textContent?.trim();
      const meta = card.querySelector('.job-meta')?.textContent?.replace(/\s+/g, ' ').trim();
      const href = anchor?.href || null;
      if (href) {
        results.push({ title, href, meta });
      }
    });
    return results.slice(0, 10);
  });
  console.log('status', response && response.status());
  console.log('finalUrl', page.url());
  console.log('jobs', JSON.stringify(jobs, null, 2));
  await browser.close();
}

async function scrapeCapgemini() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
  const url = 'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=15';
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(8000);
  const jobs = await page.evaluate(() => {
    const results = [];
    const cards = Array.from(document.querySelectorAll('a[href*="/in-en/jobs/"]'));
    cards.forEach((anchor) => {
      const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || null;
      const href = anchor.href || null;
      if (href) {
        results.push({ title, href });
      }
    });
    return results.slice(0, 10);
  });
  console.log('status', response && response.status());
  console.log('finalUrl', page.url());
  console.log('jobs', JSON.stringify(jobs, null, 2));
  await browser.close();
}

(async () => {
  console.log('=== COGNIZANT ===');
  await scrapeCognizant();
  console.log('=== CAPGEMINI ===');
  await scrapeCapgemini();
})();
