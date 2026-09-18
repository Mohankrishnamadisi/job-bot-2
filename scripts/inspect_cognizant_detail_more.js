const { chromium } = require('playwright');

(async () => {
  const url = 'https://careers.cognizant.com/global-en/jobs/00068781201/aws-rds-postgresql/';
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);

  const result = await page.evaluate(() => {
    const metaItems = Array.from(document.querySelectorAll('li.job-meta-item')).map((item) => ({
      label: item.childNodes[0]?.textContent?.trim().replace(/\s+/g, ' ') || null,
      value: item.querySelector('strong')?.textContent?.trim().replace(/\s+/g, ' ') || null,
      html: item.outerHTML,
    }));

    const summaryHeading = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((node) => /Job Summary/i.test(node.textContent || ''));
    const summarySection = summaryHeading ? summaryHeading.parentElement : null;
    const summary = summarySection ? summarySection.textContent.trim().replace(/\s+/g, ' ') : null;
    return {
      metaItems,
      summaryHeading: summaryHeading ? summaryHeading.outerHTML : null,
      summarySection: summarySection ? summarySection.outerHTML.slice(0, 800) : null,
      summaryText: summary,
      allText: document.body.textContent.slice(0, 2000).replace(/\s+/g, ' '),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
