const { chromium } = require('playwright');

async function inspect(name, url, patterns) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(8000);

  const anchors = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    Array.from(document.querySelectorAll('a[href]')).forEach((el) => {
      const href = el.getAttribute('href');
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!href || seen.has(href)) return;
      seen.add(href);
      results.push({ href, text });
    });
    return results;
  });

  console.log(`\n=== ${name} ===`);
  for (const pattern of patterns) {
    const matches = anchors.filter((a) => a.href.includes(pattern) || a.text.toLowerCase().includes(pattern));
    console.log('pattern', pattern, 'count', matches.length);
    console.log(JSON.stringify(matches.slice(0, 50), null, 2));
  }

  await browser.close();
}

(async () => {
  await inspect('cognizant', 'https://careers.cognizant.com/global-en/jobs/', ['/jobs/', '/job/', '00069', '00070']);
  await inspect('capgemini', 'https://www.capgemini.com/in-en/careers/job-search/', ['/job/', '/careers/', 'apply', 'recruitment']);
})();
