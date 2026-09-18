'use strict';

const axios = require('axios');
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

const SOURCE = 'Wipro';
const SEARCH_ENDPOINT = 'https://careers.wipro.com/services/recruiting/v1/jobs';
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_RETRY_MAX = 3;
const SEARCH_RETRY_BASE_MS = 1000;

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) return Math.max(timestamp - Date.now(), 0);
  return null;
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const response = job.response || job;
  const locationCandidates = [
    response.sfstd_jobLocation_obj,
    response.jobLocation_obj,
    response.jobLocationShort,
    response.location,
  ].filter(Boolean);

  const location = locationCandidates.reduce((acc, value) => {
    if (Array.isArray(value)) {
      const cleaned = value.map((item) => String(item || '').replace(/<br\/>/g, '').trim()).filter(Boolean);
      return cleaned.length ? cleaned.join(', ') : acc;
    }

    if (typeof value === 'string') {
      const cleaned = value.replace(/<br\/>/g, '').trim();
      return cleaned || acc;
    }

    return acc;
  }, null);

  const title = response.unifiedStandardTitle || response.title || response.jobTitle || null;
  const positionId = response.id || response.jobId || response.positionId || null;
  const urlTitle = response.urlTitle || response.unifiedUrlTitle || null;
  const countryCandidates = [response.jobLocationCountry, response.jobLocationCountryCode, response.country, response.jobLocation_country].filter(Boolean);
  const country = countryCandidates.reduce((acc, value) => {
    if (Array.isArray(value)) {
      const cleaned = value.map((item) => String(item || '').trim()).filter(Boolean);
      return cleaned.length ? cleaned[0] : acc;
    }

    if (typeof value === 'string') {
      const cleaned = value.trim();
      return cleaned || acc;
    }

    return acc;
  }, null);
  const applyUrl = positionId && urlTitle ? `https://careers.wipro.com/job/${urlTitle}/${positionId}-en_US` : null;

  return {
    positionId,
    title,
    source: SOURCE,
    company: SOURCE,
    location,
    country,
    work_mode: 'onsite',
    posted_date: response.postedDate || response.posted_date || response.unifiedStandardStart || response.createdAt || null,
    description: null,
    apply_url: applyUrl,
    employment_type: null,
    experience: null,
    salary: null,
    skills: [],
    status: 'open',
    is_active: true,
  };
}

function extractJobs(responseData) {
  if (!responseData || typeof responseData !== 'object') return [];

  const jobs = responseData.jobSearchResult || [];
  if (!Array.isArray(jobs)) return [];

  return jobs.map((job) => normalizeJob(job)).filter(Boolean);
}

async function fetchSearchPage(pageNumber, signal = null) {
  if (signal?.aborted) throw new Error('Wipro scraper timed out');

  const payload = {
    locale: 'en_US',
    pageNumber,
    keywords: '',
    location: 'india',
    sortBy: '',
    facetFilters: {},
  };

  const response = await axios.post(SEARCH_ENDPOINT, payload, {
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || 120000),
  });

  return response.data;
}

async function fetchSearchPageWithRetries(pageNumber, signal = null) {
  for (let attempt = 1; attempt <= SEARCH_RETRY_MAX; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error('Wipro scraper timed out');
      const data = await fetchSearchPage(pageNumber, signal);
      return { data, error: null };
    } catch (error) {
      if (signal?.aborted) {
        return { data: null, error: new Error('Wipro scraper timed out') };
      }
      const status = error?.response?.status;
      const retryAfterMs = parseRetryAfter(error?.response?.headers?.['retry-after']);

      if (status === 429) {
        const waitMs = retryAfterMs != null ? retryAfterMs : SEARCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(`Wipro waiting ${Math.round(waitMs / 1000)} seconds due to rate limit...`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, waitMs);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Wipro scraper timed out'));
          }, { once: true });
        });
        logger.info('Wipro retrying page...');
        if (attempt >= SEARCH_RETRY_MAX) {
          return { data: null, error };
        }
        continue;
      }

      return { data: null, error };
    }
  }

  return { data: null, error: new Error('Wipro search page retry limit exceeded') };
}

async function fetchAllSearchJobs(fullSync = false, signal = null) {
  const allJobs = [];
  const seen = new Set();
  let pageNumber = 0;
  let page = 1;
  let totalCount = -1;
  const pageLimit = fullSync ? Number.MAX_SAFE_INTEGER : 10;

  while (page <= pageLimit) {
    if (signal?.aborted) break;
    const { data, error } = await fetchSearchPageWithRetries(pageNumber, signal);
    if (error) {
      logger.warn(`Wipro skipped page ${page} after repeated search failures.`);
      break;
    }

    const pageJobs = extractJobs(data);
    logger.info(`Wipro page ${page} returned ${pageJobs.length} jobs.`);

    if (!pageJobs.length) break;

    const uniquePageJobs = pageJobs.filter((job) => {
      const key = job.apply_url || job.positionId || job.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    allJobs.push(...uniquePageJobs);

    const hits = data?.totalCount || data?.totalResults || data?.total || null;
    if (hits != null) {
      totalCount = Number(hits);
      if (allJobs.length >= totalCount) break;
    }

    if (uniquePageJobs.length < DEFAULT_PAGE_SIZE) break;

    pageNumber += 1;
    page += 1;
  }

  return {
    allJobs,
    pageCount: page,
    totalCount: totalCount >= 0 ? totalCount : allJobs.length,
  };
}

async function scrapeWiproJobs(query = '', location = '', fullSync = false, options = {}) {
  const dryRun = options?.dryRun === true || process.env.WIPRO_DRY_RUN === 'true';
  logger.info('Scraping started');
  const callSignal = options?.signal || null;
  const { allJobs, pageCount, totalCount } = await fetchAllSearchJobs(fullSync, options?.signal || null);
  const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });

  logger.info(`Jobs fetched: ${allJobs.length}`);

  if (dryRun) {
    logger.info('Wipro dry run enabled; skipping database writes.');
    return {
      result: recentJobs.filter((job) => shouldSaveJob(job)),
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
    throw new Error('ensureCompany returned no company row for Wipro');
  }

  const applyUrls = recentJobs.map((job) => job.apply_url).filter(Boolean);
  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingRows = existingResp.data || [];

  const allSourceResp = await getAllJobsBySource(SOURCE);
  const allSourceRows = allSourceResp.data || [];

  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(recentJobs, existingRows, allSourceRows);

  logger.info(`Wipro found ${newJobs.length} new, ${existingMatches.length} existing, ${removedRows.length} removed (source total ${allSourceRows.length})`);

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
    logger.error(`Wipro enrichment failed: ${error.message}`);
  }

  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  logger.info(`Search pages: ${pageCount}`);
  logger.info(`Total jobs: ${allJobs.length}`);
  logger.info(`New jobs: ${enrichmentSummary.enriched.length}`);

  const enrichedMap = new Map((enrichmentSummary.enriched || []).map((job) => [job.apply_url, job]));
  const result = recentJobs.map((job) => enrichedMap.get(job.apply_url) || job);
  const filteredResult = result.filter((job) => shouldSaveJob(job));

  return {
    result: filteredResult,
    stats: {
      pageCount,
      listingJobsFetched: allJobs.length,
      detailJobsFetched: enrichmentSummary.enriched.length,
      recentJobs: recentJobs.length,
      skippedOld: Math.max(0, allJobs.length - recentJobs.length),
      stopReason: callSignal?.aborted ? 'timeout' : 'completed normally',
      totalCount,
      totalFound: allJobs.length,
      newCount: newJobs.length,
      updatedCount: updates.length,
      removedCount: removedApplyUrls.length,
    },
  };
}

module.exports = {
  normalizeJob,
  scrapeWiproJobs,
};
