const { chromium } = require('playwright');

const targets = [
  {
    name: 'cognizant',
    url: 'https://careers.cognizant.com/global/en/search-results',
    candidatePatterns: ['cognizant', 'careers', 'job', 'search', 'api'],
  },
  {
    name: 'capgemini',
    url: 'https://www.capgemini.com/in-en/careers/job-search/',
    candidatePatterns: ['capgemini', 'careers', 'job', 'search', 'api'],
  },
];

async function inspectTarget(target) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  const network = [];
  page.on('request', (req) => {
    const url = req.url();
    if (target.candidatePatterns.some((p) => url.toLowerCase().includes(p))) {
      network.push({ type: 'request', method: req.method(), url });
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (target.candidatePatterns.some((p) => url.toLowerCase().includes(p))) {
      network.push({ type: 'response', status: res.status(), url, contentType: res.headers()['content-type'] || '' });
    }
  });

  console.log(`\n=== ${target.name.toUpperCase()} ===`);
  let response;
  try {
    response = await page.goto(target.url, { waitUntil: 'networkidle', timeout: 90000 });
    console.log('status', response && response.status());
    console.log('finalUrl', page.url());
  } catch (error) {
    console.log('gotoError', error.message);
  }

  await page.waitForTimeout(5000);
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  const snippets = bodyText.replace(/\s+/g, ' ').trim();
  console.log('bodySnippet', snippets.slice(0, 4000));

  const links = await page.$$eval('a[href]', (nodes) => nodes.map((node) => node.href).filter(Boolean));
  const uniqueLinks = Array.from(new Set(links)).slice(0, 40);
  console.log('sampleLinks', uniqueLinks);

  const apiLike = network.filter((item) => item.url.includes('api') || item.url.includes('jobs') || item.url.includes('search') || item.url.includes('graphql') || item.url.includes('recruit') || item.url.includes('job') || item.url.includes('career'));
  console.log('networkHits', apiLike.slice(0, 80));

  await browser.close();
}

(async () => {
  for (const target of targets) {
    await inspectTarget(target);
  }
})();
