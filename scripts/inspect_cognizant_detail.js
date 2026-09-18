const { chromium } = require('playwright');

(async () => {
  const url = 'https://careers.cognizant.com/global-en/jobs/00068781201/aws-rds-postgresql/';
  const browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  const data = await page.evaluate(() => {
    const all = [];
    const selectors = [
      'div', 'span', 'p', 'section', 'article', 'li'
    ];
    const texts = [];
    for (const sel of ['div', 'span', 'p', 'li']) {
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const node of nodes) {
        const text = node.textContent?.trim();
        if (text && text.length < 200 && /Location|Experience|Employment|Job Description|Description|Job Details|Country|Remote/i.test(text)) {
          texts.push({ tag: node.tagName, className: node.className, id: node.id, text, html: node.outerHTML.slice(0, 400) });
        }
      }
    }
    const location = Array.from(document.querySelectorAll('*')).find((el) => /location/i.test(el.textContent || '') && !/description/i.test(el.textContent || ''));
    return {
      title: document.querySelector('h1, h2, .job-title, .job-card-title')?.textContent?.trim() || null,
      raw: document.body.innerText.slice(0, 2000),
      selectors: texts.slice(0, 50),
      locationText: location ? location.textContent.trim().slice(0, 200) : null,
      descriptionHtml: document.querySelector('div[class*="job-description"], section[class*="description"], div[id*="job-description"], section[id*="description"]')?.outerHTML?.slice(0, 400) || null,
      pageTitle: document.title,
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
