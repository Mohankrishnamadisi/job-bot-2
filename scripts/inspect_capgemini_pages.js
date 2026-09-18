const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  const urls = [
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=11&page=1',
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=20&page=1',
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=11&page=2',
  ];
  for (const url of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
    const stats = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('ul[class*="JobList-module__job-list"] li[class*="JobRow-module__job-card-wrapper"]'));
      return {
        jobCount: cards.length,
        sample: cards.slice(0, 3).map((card) => ({
          title: card.querySelector('div[class*="JobRow-module__title"]')?.textContent?.trim() || null,
          location: card.querySelector('div[class*="JobRow-module__location"]')?.textContent?.trim() || null,
          department: card.querySelector('li[class*="professional-communities"]')?.textContent?.trim() || null,
          employment_type: card.querySelector('li[class*="contract-type"]')?.textContent?.trim() || null,
          href: card.querySelector('a[href]')?.href || null,
        })),
      };
    });
    console.log(url);
    console.log(JSON.stringify(stats, null, 2));
  }
  await browser.close();
})();
