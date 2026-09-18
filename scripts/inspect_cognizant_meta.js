const { chromium } = require('playwright');

(async () => {
  const url = 'https://careers.cognizant.com/global-en/jobs/00068781201/aws-rds-postgresql/';
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);

  const meta = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('li.job-meta-item'));
    return items.map((item) => ({
      className: item.className,
      text: item.textContent?.trim().replace(/\s+/g, ' ') || null,
      html: item.outerHTML,
    }));
  });

  const description = await page.evaluate(() => {
    const node = document.querySelector('section.job-description, div#jobDescription, div.job-description, div[class*="JobDescription"], section[class*="JobDescription"], div[class*="job-summary"], section[class*="job-summary"]');
    return node ? { tag: node.tagName, className: node.className, html: node.outerHTML.slice(0, 800), text: node.textContent?.trim().slice(0, 1000) } : null;
  });

  const experience = await page.evaluate(() => {
    const match = Array.from(document.querySelectorAll('span, div, li, p')).find((node) => /experience/i.test(node.textContent || ''));
    return match ? { tag: match.tagName, className: match.className, text: match.textContent?.trim().slice(0, 200) } : null;
  });

  console.log(JSON.stringify({ meta, description, experience }, null, 2));
  await browser.close();
})();
