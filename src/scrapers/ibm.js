'use strict';

const logger = require('../utils/logger');
const { newPage } = require('./browser');
const { ensureCompany } = require('../database/companyRepository');
const {
  getJobsBySourceAndApplyUrls,
  saveJobs,
  updateJobs,
  markJobsInactive,
  getAllJobsBySource,
} = require('../database/jobRepository');
const { shouldSaveJob } = require('../parsers/common/jobFilters');
const {
  findJobsForSync,
  buildJobUpdates,
  saveNewJobs,
  updateExistingJobs,
  markRemovedJobs,
} = require('../parsers/common/jobSyncService');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'IBM';
const SEARCH_URL = 'https://www.ibm.com/careers/search';

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const applyUrl = job.href || job.apply_url || job.url || null;
  const positionId = job.positionId || job.jobId || (applyUrl?.match(/[?&]jobId=([^&]+)/i)?.[1] || null);
  const rawTitle = job.title || job.name || null;
  const title = rawTitle ? String(rawTitle).replace(/\s*\.st0\{[^}]*\}.*$/i, '').trim() : null;
  const location = job.location || null;
  const country = job.country || (/\b(?:India|,\s*IN)\b/i.test(`${location || ''} ${title || ''}`) ? 'India' : null);

  if (!title || !applyUrl) return null;

  return {
    positionId,
    title: String(title).replace(/\s+/g, ' ').trim(),
    source: SOURCE,
    company: SOURCE,
    location: location ? String(location).replace(/\s+/g, ' ').trim() : null,
    country,
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
    if (signal?.aborted) throw new Error('IBM scraper timed out');
    await page.goto(SEARCH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || 120000),
    });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    return await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map((anchor) => {
        const href = anchor.href || '';
        if (!/^https:\/\/careers\.ibm\.com\/en_US\/careers\/JobDetail\?jobId=/i.test(href)) return null;
        const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
        const container = anchor.closest('li, article, div');
        const containerText = container?.textContent?.replace(/\s+/g, ' ').trim() || '';
        return { href, title, location: containerText.replace(title, '').trim() || null };
      })
      .filter(Boolean));
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    await page.close().catch(() => {});
  }
}

async function scrapeIbmJobs(query = '', location = '', fullSync = false, options = {}) {
  const signal = options?.signal || null;
  const rawJobs = await fetchSearchJobs(signal);
  const seen = new Set();
  const allJobs = rawJobs
    .map(normalizeJob)
    .filter((job) => job && !seen.has(job.apply_url) && seen.add(job.apply_url));
  const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });

  if (options?.dryRun === true || process.env.IBM_DRY_RUN === 'true') {
    return { result: recentJobs.filter(shouldSaveJob), stats: { pageCount: 1, totalFound: allJobs.length, recentJobs: recentJobs.length } };
  }

  const company = await ensureCompany({ name: SOURCE });
  if (!company) throw new Error('ensureCompany returned no company row for IBM');

  const applyUrls = recentJobs.map((job) => job.apply_url).filter(Boolean);
  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const allSourceResp = await getAllJobsBySource(SOURCE);
  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(
    recentJobs,
    existingResp.data || [],
    allSourceResp.data || []
  );
  const enriched = newJobs.filter(shouldSaveJob);
  if (enriched.length) await saveNewJobs({ enriched }, saveJobs, logger);
  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  return {
    result: recentJobs.filter(shouldSaveJob),
    stats: {
      pageCount: 1,
      listingJobsFetched: allJobs.length,
      recentJobs: recentJobs.length,
      skippedOld: allJobs.length - recentJobs.length,
      totalFound: allJobs.length,
      newCount: enriched.length,
      updatedCount: updates.length,
      removedCount: removedApplyUrls.length,
      stopReason: signal?.aborted ? 'timeout' : 'completed normally',
    },
  };
}

module.exports = { normalizeJob, fetchSearchJobs, scrapeIbmJobs };