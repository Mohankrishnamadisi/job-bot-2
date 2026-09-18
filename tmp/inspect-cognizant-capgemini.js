const { chromium } = require('playwright');

async function inspectSite(name, url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const requests = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/jobs|job|search|api|graphql|recruit/i.test(u)) requests.push({ method: req.method(), url: u });
  });
  page.on('response', (res) => {
    const u = res.url();
    if (/jobs|job|search|api|graphql|recruit/i.test(u)) requests.push({ status: res.status(), url: u, contentType: res.headers()['content-type'] });
  });

  console.log(`\n=== ${name} ===`);
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    console.log('status', response && response.status());
    console.log('finalUrl', page.url());
    await page.waitForTimeout(8000);
  } catch (err) {
    console.log('gotoError', err.message);
    await browser.close();
    return;
  }

  const jobLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links
      .map((el) => ({ href: el.href, text: (el.textContent || '').replace(/\s+/g, ' ').trim(), class: el.className, id: el.id }))
      .filter((entry) => /job|jobs|career|apply/i.test(entry.href) || /job|jobs|career|apply/i.test(entry.text.toLowerCase()))
      .slice(0, 120);
  });

  console.log('jobLinks', JSON.stringify(jobLinks, null, 2));

  const dataNodes = await page.evaluate(() => {
    const candidates = [];
    document.querySelectorAll('script, [data-], [id], [class]').forEach((el) => {
      const text = (el.textContent || '').trim();
      if (text && /job|jobs|apply|search|result|payload|graphql|api/i.test(text)) {
        candidates.push((text || '').slice(0, 1000));
      }
    });
    return candidates.slice(0, 40);
  });
  console.log('dataNodes', dataNodes.slice(0, 20));

  console.log('network', JSON.stringify(requests.slice(0, 120), null, 2));

  await browser.close();
}

(async () => {
  await inspectSite('cognizant', 'https://careers.cognizant.com/global-en/jobs/');
  await inspectSite('capgemini', 'https://www.capgemini.com/in-en/careers/job-search/');
})();
