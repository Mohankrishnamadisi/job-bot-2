const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  const urls = [
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=20&page=1',
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=20&page=2',
    'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=20&page=3',
  ];
  for (const url of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
    const jobs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('ul[class*="JobList-module__job-list"] a[href*="/in-en/jobs/"]')).map((anchor) => ({
        href: anchor.href,
        title: anchor.querySelector('div[class*="JobRow-module__title"]')?.textContent?.trim() || null,
        location: anchor.querySelector('div[class*="JobRow-module__location"]')?.textContent?.trim() || null,
      }));
    });
    console.log('URL:', url);
    console.log('Count:', jobs.length);
    console.log(JSON.stringify(jobs.map((j) => ({ href: j.href, title: j.title, location: j.location })), null, 2));
  }
  await browser.close();
})();
