'use strict';

const { chromium } = require('playwright');
const logger = require('../utils/logger');
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

const SOURCE = 'Capgemini';
const SEARCH_BASE_URL = 'https://www.capgemini.com/in-en/careers/join-capgemini/job-search/';
const SEARCH_RETRY_MAX = 3;
const SEARCH_RETRY_BASE_MS = 1000;
const DEFAULT_SCRAPER_TIMEOUT_MS = 120000;

function getScraperContext() {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS) > 0
    ? Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS)
    : DEFAULT_SCRAPER_TIMEOUT_MS;
  const context = { controller, signal: controller.signal, stopReason: null };
  context.timeout = setTimeout(() => {
    context.stopReason = 'timed out';
    controller.abort();
  }, timeoutMs);
  return context;
}

function buildSearchUrl(page = 1) {
  return `${SEARCH_BASE_URL}?country_code=in-en&country_name=India&size=20&page=${page}`;
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) return Math.max(timestamp - Date.now(), 0);
  return null;
}

function buildAbsoluteUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://www.capgemini.com${trimmed}`;
  return `https://www.capgemini.com/${trimmed}`;
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const href = job.href || job.apply_url || job.applyUrl || job.url || null;
  const applyUrl = buildAbsoluteUrl(href);
  const title = job.title || job.name || job.jobTitle || null;
  const rawLocation = job.location || job.loc || job.workLocation || null;
  const description = job.description || job.summary || null;
  const positionId = job.positionId || job.id || job.jobId || null;

  return {
    positionId,
    title,
    source: SOURCE,
    company: SOURCE,
    location: rawLocation || null,
    department: job.department || null,
    country: job.country || null,
    work_mode: job.work_mode || job.workMode || null,
    posted_date: job.posted_date || job.postedDate || null,
    description,
    apply_url: applyUrl,
    employment_type: job.employment_type || job.employmentType || null,
    experience: job.experience || null,
    salary: job.salary || null,
    skills: Array.isArray(job.skills) ? job.skills : [],
    status: 'open',
    is_active: true,
  };
}

function extractJobs(responseData) {
  if (!Array.isArray(responseData)) return [];

  return responseData
    .map((job) => normalizeJob({
      title: job?.title || null,
      href: job?.href || job?.apply_url || null,
      location: job?.location || null,
      department: job?.department || null,
      employment_type: job?.employment_type || job?.employmentType || null,
      posted_date: job?.posted_date || job?.postedDate || job?.datePosted || job?.publishedDate || null,
    }))
    .filter((job) => job && job.title && job.apply_url);
}

async function fetchSearchPage(pageNumber = 1, signal) {
  let browser;
  let page;

  try {
    if (signal?.aborted) throw new Error('Capgemini scraper timed out');
    browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
    page = await browser.newPage();
    const closeOnAbort = () => page?.close().catch(() => {});
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    const configuredTimeout = Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || DEFAULT_SCRAPER_TIMEOUT_MS);
    const pageTimeout = Math.max(5000, Math.min(60000, configuredTimeout - 1000));
    page.setDefaultTimeout(pageTimeout);
    page.setDefaultNavigationTimeout(pageTimeout);

    await page.goto(buildSearchUrl(pageNumber), { waitUntil: 'domcontentloaded', timeout: pageTimeout });
    await page.waitForLoadState('networkidle', { timeout: Math.min(5000, pageTimeout) }).catch(() => {});
    await page.waitForSelector('ul[class*="JobList-module__job-list"] a[href*="/in-en/jobs/"]', { timeout: pageTimeout });
    await page.waitForTimeout(Math.min(4000, pageTimeout));

    const result = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll('ul[class*="JobList-module__job-list"] a[href*="/in-en/jobs/"]')
      );

      return anchors.map((anchor) => {
        const title = anchor.querySelector('div[class*="JobRow-module__title"], span[class*="JobRow-module__title"], h3, h2')?.textContent?.trim() || null;
        const location = anchor.querySelector('div[class*="JobRow-module__location"], span[class*="JobRow-module__location"], .location')?.textContent?.trim() || null;
        const department = anchor.querySelector('li[class*="professional-communities"], li[class*="business-area"], [data-test*=department], [data-test*=business]')?.textContent?.trim() || null;
        const employment_type = anchor.querySelector('li[class*="contract-type"], li[class*="job-type"], [data-test*=employment], .employment-type')?.textContent?.trim() || null;
        const posted_date = anchor.querySelector('time, [data-test*=date], [class*="date"]')?.getAttribute('datetime') || anchor.querySelector('time, [data-test*=date], [class*="date"]')?.textContent?.trim() || null;
        const href = anchor.href || null;

        return {
          title,
          location,
          department,
          employment_type,
          posted_date,
          href,
        };
      });
    });

    signal?.removeEventListener('abort', closeOnAbort);
    return result;
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function fetchSearchPageWithRetries(pageNumber = 1, signal) {
  for (let attempt = 1; attempt <= SEARCH_RETRY_MAX; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error('Capgemini scraper timed out');
      const data = await fetchSearchPage(pageNumber, signal);
      return { data, error: null };
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Capgemini scraper timed out');
      }
      const status = error?.response?.status;
      const retryAfterMs = parseRetryAfter(error?.response?.headers?.['retry-after']);

      if (status === 429) {
        const waitMs = retryAfterMs != null ? retryAfterMs : SEARCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(`Capgemini waiting ${Math.round(waitMs / 1000)} seconds due to rate limit...`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, waitMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Capgemini scraper timed out'));
          }, { once: true });
        });
        logger.info('Capgemini retrying search page...');
        if (attempt >= SEARCH_RETRY_MAX) {
          return { data: null, error };
        }
        continue;
      }

      return { data: null, error };
    }
  }

  return { data: null, error: new Error('Capgemini search page retry limit exceeded') };
}

async function fetchAllSearchJobs(fullSync = false, signal, fetchPageWithRetries = fetchSearchPageWithRetries) {
  const allJobs = [];
  const seen = new Set();
  const configuredPageLimit = Number(process.env.MAX_PAGES_PER_COMPANY);
  const pageLimit = Number.isFinite(configuredPageLimit) && configuredPageLimit > 0 ? configuredPageLimit : 100;
  let pagesVisited = 0;
  let prevPageUrls = null;

  for (let page = 1; page <= pageLimit; page += 1) {
    if (signal?.aborted) throw new Error('Capgemini scraper timed out');
    let data;
    let error;
    try {
      ({ data, error } = await fetchPageWithRetries(page, signal));
    } catch (pageError) {
      logger.warn(`Capgemini stopped after page ${page - 1}: ${pageError.message}`);
      return {
        allJobs,
        pageCount: pagesVisited,
        totalCount: allJobs.length,
        stopReason: signal?.aborted ? 'timed out' : 'page failed',
      };
    }
    pagesVisited += 1;

    if (error) {
      logger.warn(`Capgemini stopped after page ${page - 1}: ${error.message || 'page failed'}`);
      return {
        allJobs,
        pageCount: pagesVisited,
        totalCount: allJobs.length,
        stopReason: signal?.aborted ? 'timed out' : 'page failed',
      };
    }

    const pageJobs = extractJobs(data);
    logger.info(`Page ${page} fetched ${pageJobs.length} jobs`);

    if (!pageJobs.length) {
      break;
    }

    const currentPageUrls = pageJobs.map((job) => job.apply_url).filter(Boolean);
    const sameAsPrev = prevPageUrls && currentPageUrls.length === prevPageUrls.length && currentPageUrls.every((url, index) => url === prevPageUrls[index]);
    prevPageUrls = currentPageUrls;

    if (sameAsPrev) {
      logger.info(`Page ${page} repeated previous page; stopping.`);
      break;
    }

    const recentPageJobs = filterJobsWithinRecentCutoff(pageJobs, { includeUnknownDate: true });
    const uniquePageJobs = recentPageJobs.filter((job) => {
      const key = job.apply_url || job.positionId || job.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`New unique jobs ${uniquePageJobs.length}`);

    allJobs.push(...uniquePageJobs);
  }

  logger.info(`Total pages visited ${pagesVisited}`);
  logger.info(`Total unique jobs ${allJobs.length}`);

  return {
    allJobs,
    pageCount: pagesVisited,
    totalCount: allJobs.length,
  };
}

async function scrapeCapgeminiJobs(query = '', location = '', fullSync = false, options = {}) {
  const dryRun = options?.dryRun === true || process.env.CAPGEMINI_DRY_RUN === 'true';
  const context = getScraperContext();
  if (options?.signal) {
    if (options.signal.aborted) {
      context.stopReason = 'timed out';
      context.controller.abort();
    } else {
      options.signal.addEventListener('abort', () => {
        context.stopReason = 'timed out';
        context.controller.abort();
      }, { once: true });
    }
  }
  logger.info('Scraping started');
  try {
    const { allJobs, pageCount, totalCount, stopReason } = await fetchAllSearchJobs(fullSync, context.signal);
    const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });

  logger.info(`Jobs fetched: ${allJobs.length}`);

  if (dryRun) {
    logger.info('Capgemini dry run enabled; skipping database writes.');
    return {
      result: recentJobs,
      stats: {
        pageCount,
        totalCount,
        totalFound: allJobs.length,
        newCount: allJobs.length,
        updatedCount: 0,
        removedCount: 0,
      },
    };
  }

  const company = await ensureCompany({ name: SOURCE });
  if (!company) {
    throw new Error('ensureCompany returned no company row for Capgemini');
  }

  const applyUrls = recentJobs.map((job) => job.apply_url).filter(Boolean);
  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingRows = existingResp.data || [];
  const allSourceResp = await getAllJobsBySource(SOURCE);
  const allSourceRows = allSourceResp.data || [];

  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(recentJobs, existingRows, allSourceRows);

  logger.info(`Capgemini found ${newJobs.length} new, ${existingMatches.length} existing, ${removedRows.length} removed (source total ${allSourceRows.length})`);

  let enrichmentSummary = { enriched: [], success: 0, failed: 0, skipped: 0 };

  try {
    const enrichedJobs = newJobs.filter((job) => shouldSaveJob(job));
    enrichmentSummary = {
      enriched: enrichedJobs,
      success: enrichedJobs.length,
      failed: 0,
      skipped: 0,
    };

    if (enrichmentSummary.enriched.length) {
      await saveNewJobs(enrichmentSummary, saveJobs, logger);
    }
  } catch (error) {
    logger.error(`Capgemini enrichment failed: ${error.message}`);
  }

  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  logger.info(`Search pages: ${pageCount}`);
  logger.info(`Total jobs: ${allJobs.length}`);
  logger.info(`New jobs: ${enrichmentSummary.enriched.length}`);

  const enrichedMap = new Map((enrichmentSummary.enriched || []).map((job) => [job.apply_url, job]));
  const result = recentJobs.map((job) => enrichedMap.get(job.apply_url) || job);

  return {
    result,
    stats: {
      pageCount,
      listingJobsFetched: allJobs.length,
      detailJobsFetched: enrichmentSummary.enriched.length,
      recentJobs: recentJobs.length,
      skippedOld: Math.max(0, allJobs.length - recentJobs.length),
      stopReason: stopReason || context.stopReason || 'completed normally',
      totalCount,
      totalFound: allJobs.length,
      newCount: newJobs.length,
      updatedCount: updates.length,
      removedCount: removedApplyUrls.length,
    },
  };
  } finally {
    clearTimeout(context.timeout);
  }
}

module.exports = {
  normalizeJob,
  scrapeCapgeminiJobs,
  fetchAllSearchJobs,
};
