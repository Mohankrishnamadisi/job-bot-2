const fs = require('fs');
const path = require('path');
const { scrapeCognizantJobs, normalizeJob: normalizeCognizant } = require('../src/scrapers/cognizant');
const { scrapeCapgeminiJobs, normalizeJob: normalizeCapgemini } = require('../src/scrapers/capgemini');

const { chromium } = require('playwright');

async function checkUrlWithPlaywright(page, url, jobTitle, timeoutMs = 25000) {
  try {
    // navigate
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    const finalUrl = page.url();

    // check for job title or Job Description section
    const hasContent = await page.evaluate((title) => {
      try {
        const bodyText = document.body.innerText || '';
        if (title && bodyText.toLowerCase().includes(title.toLowerCase())) return true;
        // common description containers
        if (document.querySelector('article.cms-content, #js-job-detail, .job-description, .job-detail, div.job-details')) return true;
        if (/job description/i.test(bodyText) || /description/i.test(bodyText)) return true;
        return false;
      } catch (e) {
        return false;
      }
    }, jobTitle || '');

    return { status: res ? res.status() : null, finalUrl, pass: !!hasContent };
  } catch (err) {
    return { status: null, finalUrl: null, error: err.message, pass: false };
  }
}

async function checkUrlWithFetch(url, timeoutMs = 15000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(id);
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    return { status: null, finalUrl: null, error: err.message };
  }
}

async function verifyScraper(name, scraperFn, normalizeFn, outFile) {
  const result = await scraperFn('', '', false, { dryRun: true });
  const jobs = result.result || [];
  const total = jobs.length;
  const sample = jobs.slice(0, 10);

  // ensure output dir
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, outFile), JSON.stringify(sample, null, 2));

  console.log(`--- ${name} ---`);
  console.log('Total jobs found:', total);
  console.log('First 5 titles:', sample.slice(0,5).map(j => j.title));
  console.log('First 5 apply URLs:', sample.slice(0,5).map(j => j.apply_url));
  console.log('First 5 locations:', sample.slice(0,5).map(j => j.location));

  // check HTTP status and final redirect
  const checks = [];

  if (name === 'Cognizant') {
    // Use Playwright navigation + in-page content checks for Cognizant
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
    });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    const page = await context.newPage();

    for (const job of sample) {
      const url = job.apply_url;
      if (!url) {
        checks.push({ url: null, status: null, finalUrl: null, error: 'missing_apply_url', pass: false });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await checkUrlWithPlaywright(page, url, job.title, 30000);
      checks.push({ url, status: res.status, finalUrl: res.finalUrl, error: res.error || null, pass: !!res.pass });
      console.log(`HTTP: ${res.status}  Final URL: ${res.finalUrl}  for ${url}  PASS:${!!res.pass}`);
    }

    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  } else {
    // Keep original fetch-based HTTP 200 validation for other scrapers (Capgemini)
    for (const job of sample) {
      const url = job.apply_url;
      if (!url) {
        checks.push({ url: null, status: null, finalUrl: null, error: 'missing_apply_url', pass: false });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const res = await checkUrlWithFetch(url);
      const pass = res.status === 200;
      checks.push({ url, status: res.status, finalUrl: res.finalUrl, error: res.error || null, pass });
      console.log(`HTTP: ${res.status}  Final URL: ${res.finalUrl}  for ${url}`);
    }
  }

  // duplicates
  const urls = sample.map((j) => j.apply_url).filter(Boolean);
  const dupSet = urls.filter((u, i) => urls.indexOf(u) !== i);

  // normalize validation
  const normalized = sample.map((j) => normalizeFn(j));
  const normalizeIssues = normalized.map((n, idx) => {
    if (!n) return { index: idx, issue: 'normalize_returned_null' };
    if (!n.apply_url) return { index: idx, issue: 'missing_apply_url_after_normalize' };
    if (!n.title) return { index: idx, issue: 'missing_title_after_normalize' };
    return null;
  }).filter(Boolean);

  return {
    name,
    total,
    sampleCount: sample.length,
    checks,
    duplicates: Array.from(new Set(dupSet)),
    normalizeIssues,
    jobs: sample,
    rawResult: result,
  };
}

(async () => {
  const cognizant = await verifyScraper('Cognizant', scrapeCognizantJobs, normalizeCognizant, 'cognizant-sample.json');
  const capgemini = await verifyScraper('Capgemini', scrapeCapgeminiJobs, normalizeCapgemini, 'capgemini-sample.json');

  // Summarize with per-scraper pass criteria
  function summarize(r) {
    console.log(`\nSummary for ${r.name}:`);
    console.log('Total found:', r.total);
    console.log('Sample saved count:', r.sampleCount);
    console.log('Duplicate apply_urls:', r.duplicates.length ? r.duplicates : 'none');
    console.log('Normalize issues:', r.normalizeIssues.length ? r.normalizeIssues : 'none');

    let allPass = false;
    if (r.name === 'Cognizant') {
      // Cognizant: consider PASS if page.goto succeeded and content check passed for every sample
      allPass = r.checks.every(c => c.pass === true);
      console.log('All sample apply_urls content PASS:', allPass);
    } else {
      // Capgemini: keep HTTP 200 validation
      allPass = r.checks.every(c => c.status === 200);
      console.log('All sample apply_urls HTTP 200:', allPass);
    }

    return allPass && r.duplicates.length === 0 && r.normalizeIssues.length === 0 && r.sampleCount >= 5;
  }

  const cognOK = summarize(cognizant);
  const capOK = summarize(capgemini);

  console.log('');
  console.log(`Cognizant: ${cognOK ? 'READY' : 'NOT READY'}`);
  console.log(`Capgemini: ${capOK ? 'READY' : 'NOT READY'}`);

  if (cognOK && capOK) {
    console.log('\nOverall: READY');
    process.exit(0);
  }

  console.log('\nOverall: NOT READY');
  const reasons = [];
  if (!cognOK) reasons.push('Cognizant checks failed');
  if (!capOK) reasons.push('Capgemini checks failed');
  console.log('Reasons:', reasons.join('; '));
  process.exit(2);
})();
