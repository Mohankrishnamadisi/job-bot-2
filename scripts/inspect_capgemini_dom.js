const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  await page.goto('https://www.capgemini.com/in-en/careers/join-capgemini/job-search/?country_code=in-en&country_name=India&size=11&page=1', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);

  const jobs = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div.job-offer, article.job-card, div.job-item, div[class*="job"]'));
    return nodes.slice(0, 20).map((node) => {
      const title = node.querySelector('h3, h2, .job-offer__title, .job-title, .oec-job-title, .job-offer__title-text, [data-test*=title]')?.textContent?.trim() || null;
      const location = node.querySelector('span.job-offer__location, .job-location, .location, [data-test*=location], .job-offer__meta-item')?.textContent?.trim() || null;
      const dept = node.querySelector('span.job-offer__business-area, .business-area, [data-test*=department], .job-offer__business-area')?.textContent?.trim() || null;
      const emp = node.querySelector('span.job-offer__type, .employment-type, .job-type, [data-test*=employment], .job-offer__employment-type')?.textContent?.trim() || null;
      const anchor = node.querySelector('a[href]');
      const href = anchor ? anchor.href : null;
      return {
        title,
        location,
        department: dept,
        employment_type: emp,
        apply_url: href,
        outerHTML: node.outerHTML.slice(0, 700),
      };
    });
  });

  console.log(JSON.stringify(jobs, null, 2));
  await browser.close();
})();
