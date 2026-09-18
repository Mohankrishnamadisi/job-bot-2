const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  const url = 'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=20&page=1';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  const pagination = await page.evaluate(() => {
    const selectors = [
      'nav',
      'ul[class*="pagination"]',
      'div[class*="pagination"]',
      'a',
      'button',
      'div[class*="page"]',
      'div[class*="jobs-pagination"]',
    ];
    const nodes = Array.from(document.querySelectorAll(selectors.join(','))).map((node) => ({
      tag: node.tagName,
      className: node.className,
      id: node.id,
      text: node.textContent?.trim().slice(0, 120),
      html: node.outerHTML.slice(0, 400),
    })).slice(0, 40);
    return nodes;
  });
  console.log(JSON.stringify(pagination, null, 2));
  await browser.close();
})();
