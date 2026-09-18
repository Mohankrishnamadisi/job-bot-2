const { chromium } = require('playwright');

(async () => {
  const url = 'https://careers.cognizant.com/global-en/jobs/00068781201/aws-rds-postgresql/';
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);

  const nodes = await page.evaluate(() => {
    const results = [];
    const textPatterns = ['Job Summary', 'Experience', 'Work model', 'Location', 'Employment', 'Job category'];
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const text = el.textContent?.trim();
      if (!text) continue;
      if (textPatterns.some((pat) => text.includes(pat))) {
        results.push({
          tag: el.tagName,
          className: el.className || null,
          id: el.id || null,
          text: text.slice(0, 300),
          html: el.outerHTML.slice(0, 800),
        });
        if (results.length >= 40) break;
      }
    }
    return results;
  });
  console.log(JSON.stringify(nodes, null, 2));
  await browser.close();
})();
