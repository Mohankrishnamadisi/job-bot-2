const { chromium } = require('playwright');

async function inspect(url, name) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(6000);

  console.log('\n===', name, '===');
  console.log('URL', page.url());
  const allLinks = await page.$$eval('a[href]', (nodes) => nodes.map((n) => n.href).filter(Boolean));
  const jobLike = allLinks.filter((href) => /job|jobs|career|recruit|apply/i.test(href));
  console.log('jobLikeLinks', jobLike.slice(0, 60));

  const jobAnchors = await page.$$eval('a[href]', (nodes) => nodes.slice(0, 80).map((n) => ({ href: n.href, text: (n.textContent || '').replace(/\s+/g, ' ').trim(), className: n.className, id: n.id })));
  console.log('sampleAnchors', JSON.stringify(jobAnchors.slice(0, 80), null, 2));

  const scripts = await page.$$eval('script', (nodes) => nodes.map((n) => (n.textContent || '').slice(0, 1000)));
  const scriptCandidates = scripts.filter((s) => /job|jobs|apply|search|result|payload|graphql|api/i.test(s));
  console.log('scriptCandidates', scriptCandidates.slice(0, 20));

  const text = await page.evaluate(() => document.body.innerText || '');
  console.log('bodyTextSnippet', text.replace(/\s+/g, ' ').slice(0, 6000));

  await browser.close();
}

(async () => {
  await inspect('https://careers.cognizant.com/global-en/jobs/', 'cognizant');
  await inspect('https://www.capgemini.com/in-en/careers/job-search/', 'capgemini');
})();
