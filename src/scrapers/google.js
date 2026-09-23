'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'Google';
const SEARCH_URL = 'https://www.google.com/about/careers/applications/jobs/results/';
const DETAIL_PREFIX = 'https://www.google.com/about/careers/applications/jobs/results/';

function normalizeJob(job) {
  if (!job || typeof job !== 'object' || !job.href || !job.title) return null;

  const applyUrl = job.href;
  const positionId = job.positionId || applyUrl.match(/\/results\/(\d+)/i)?.[1] || null;
  const location = job.location || null;
  return {
    positionId,
    title: String(job.title).replace(/\s+/g, ' ').trim(),
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location: location ? String(location).replace(/\s+/g, ' ').trim() : null,
    country: job.country || (/\bIndia\b/i.test(`${location || ''}`) ? 'India' : null),
    work_mode: job.work_mode || null,
    posted_date: job.posted_date || null,
    description: job.description || null,
    apply_url: applyUrl,
    applyUrl,
    employment_type: job.employment_type || null,
    experience: job.experience || null,
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
    if (signal?.aborted) throw new Error('Google scraper timed out');
    await page.goto(SEARCH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || 120000),
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    return await page.evaluate((detailPrefix) => Array.from(document.querySelectorAll('a[href*="/results/"]'))
      .map((anchor) => {
        const href = anchor.href || '';
        if (!href.startsWith(detailPrefix)) return null;
        const card = anchor.closest('.sMn82b') || anchor.closest('[role="listitem"]') || anchor.parentElement;
        const title = card?.querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim()
          || anchor.getAttribute('aria-label')?.replace(/^Learn more about\s+/i, '').trim()
          || '';
        const location = card?.querySelector('.r0wTof')?.textContent?.replace(/\s+/g, ' ').trim() || null;
        const description = card?.querySelector('.Xsxa1e')?.textContent?.replace(/\s+/g, ' ').trim() || null;
        return { href, title, location, description };
      })
      .filter((job) => job && job.title && job.href), DETAIL_PREFIX);
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await page.close().catch(() => {});
  }
}

async function scrapeGoogleJobs(query = '', location = '', fullSync = false, options = {}) {
  const rawJobs = await fetchSearchJobs(options.signal);
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
      stopReason: options.signal?.aborted ? 'timeout' : 'completed normally',
    },
  };
}

module.exports = { normalizeJob, fetchSearchJobs, scrapeGoogleJobs };