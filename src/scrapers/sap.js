'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'SAP';
const SEARCH_URL = 'https://careers.sap.com/search/?locale=en_US';

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const applyUrl = job.href || job.apply_url || job.url || null;
  const rawTitle = job.title || job.name || null;
  const title = rawTitle ? String(rawTitle).replace(/\s+/g, ' ').trim() : null;
  const location = job.location ? String(job.location).replace(/\s+/g, ' ').trim() : null;

  if (!title || !applyUrl) return null;

  return {
    positionId: job.positionId || job.jobId || (applyUrl.match(/\/job\/[^/?#]+\/([^/?#]+)/i)?.[1] || null),
    title,
    source: SOURCE,
    company: SOURCE,
    location,
    country: /\b(?:India|IN)\b/i.test(location || '') ? 'India' : null,
    work_mode: null,
    posted_date: job.posted_date || job.postedDate || null,
    description: job.description || null,
    apply_url: applyUrl,
    employment_type: null,
    experience: null,
    salary: null,
    skills: [],
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchJobs(signal = null) {
  const page = await newPage();
  const closeOnAbort = () => page.close().catch(() => {});
  signal?.addEventListener('abort', closeOnAbort, { once: true });

  try {
    if (signal?.aborted) throw new Error('SAP scraper timed out');
    await page.goto(SEARCH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || 120000),
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);

    const pageTitle = await page.title();
    const pageText = await page.locator('body').innerText().catch(() => '');
    if (/just a moment|security check|access denied|verify you are human|performing security verification/i.test(`${pageTitle} ${pageText}`)) {
      throw new Error(`SAP careers page blocked by protection challenge: ${pageTitle}`);
    }

    return await page.evaluate(() => Array.from(document.querySelectorAll('a.jobTitle-link[href], a[href*="/job/"]'))
      .map((anchor) => {
        const href = anchor.href || '';
        if (!/https:\/\/careers\.sap\.com\/job\//i.test(href)) return null;
        const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
        const container = anchor.closest('tr, li, article, .job-tile, .job-listing, div');
        const location = container?.querySelector('.jobLocation')?.textContent?.replace(/\s+/g, ' ').trim() || null;
        return { href, title, location };
      })
      .filter((job) => job && job.title));
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await page.close().catch(() => {});
  }
}

async function scrapeSapJobs(query = '', location = '', fullSync = false, options = {}) {
  const rawJobs = await fetchSearchJobs(options?.signal || null);
  const seen = new Set();
  const allJobs = rawJobs
    .map(normalizeJob)
    .filter((job) => job && !seen.has(job.apply_url) && seen.add(job.apply_url));
  const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });

  return {
    result: recentJobs,
    stats: {
      pageCount: 1,
      listingJobsFetched: allJobs.length,
      recentJobs: recentJobs.length,
      skippedOld: allJobs.length - recentJobs.length,
      stopReason: options?.signal?.aborted ? 'timeout' : 'completed normally',
    },
  };
}

module.exports = { normalizeJob, fetchSearchJobs, scrapeSapJobs };