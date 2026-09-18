const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const seen = new Set();
  const entries = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/job|search|api|graphql|career|recruit/i.test(u) && !seen.has(u)) {
      seen.add(u);
      entries.push({ type: 'request', method: req.method(), url: u });
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (/job|search|api|graphql|career|recruit/i.test(u) && !seen.has(u)) {
      seen.add(u);
      entries.push({ type: 'response', status: res.status(), url: u, contentType: res.headers()['content-type'] || '' });
    }
  });

  const url = 'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=15';
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('status', res && res.status());
  console.log('finalUrl', page.url());
  await page.waitForTimeout(12000);

  const bodyText = await page.evaluate(() => document.body.innerText || '');
  console.log('bodySnippet', bodyText.replace(/\s+/g, ' ').slice(0, 6000));
  console.log('network entries:', JSON.stringify(entries.slice(0, 200), null, 2));

  await browser.close();
})();
