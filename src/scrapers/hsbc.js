'use strict';

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

const SOURCE = 'HSBC';
const SEARCH_URL = 'https://portal.careers.hsbc.com/api/apply/v2/jobs';
const DEFAULT_PAGE_SIZE = 10;

function buildSearchUrl(start = 0, num = DEFAULT_PAGE_SIZE) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('domain', 'hsbc.com');
  url.searchParams.set('start', String(start));
  url.searchParams.set('num', String(num));
  url.searchParams.set('sort_by', 'relevance');
  return url.toString();
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const applyUrl = job.canonicalPositionUrl || job.apply_url || job.url || null;
  const title = job.posting_name || job.name || job.title || null;
  if (!title || !applyUrl) return null;

  const createdAt = Number(job.t_create || job.t_update);
  const postedDate = job.posted_date || job.postedDate || (createdAt > 0
    ? new Date(createdAt < 1e12 ? createdAt * 1000 : createdAt).toISOString()
    : null);

  return {
    positionId: job.id || job.ats_job_id || null,
    title: String(title).replace(/\s+/g, ' ').trim(),
    source: SOURCE,
    company: SOURCE,
    location: job.location || (Array.isArray(job.locations) ? job.locations.join('; ') : null),
    department: job.department || job.business_unit || null,
    country: null,
    work_mode: job.work_location_option || null,
    posted_date: postedDate,
    description: job.job_description || job.description || null,
    apply_url: applyUrl,
    employment_type: job.employment_type || null,
    experience: null,
    salary: null,
    skills: [],
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(start = 0, num = DEFAULT_PAGE_SIZE, signal = null, fetchImpl = globalThis.fetch) {
  if (signal?.aborted) throw new Error('HSBC scraper timed out');
  const response = await fetchImpl(buildSearchUrl(start, num), {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
    signal,
  });
  if (!response.ok) throw new Error(`HSBC jobs API returned HTTP ${response.status}`);

  const data = await response.json();
  return {
    positions: Array.isArray(data?.positions) ? data.positions : [],
    count: Number(data?.count) || 0,
  };
}

async function fetchAllSearchJobs(maxJobs = 100, signal = null, fetchPage = fetchSearchPage) {
  const limit = Number(maxJobs) > 0 ? Number(maxJobs) : 100;
  const jobs = [];
  const seen = new Set();
  let totalCount = 0;
  let start = 0;

  while (jobs.length < limit) {
    if (signal?.aborted) throw new Error('HSBC scraper timed out');
    const num = Math.min(DEFAULT_PAGE_SIZE, limit - jobs.length);
    const page = await fetchPage(start, num, signal);
    totalCount = page.count;

    for (const job of page.positions) {
      const normalized = normalizeJob(job);
      if (normalized && !seen.has(normalized.apply_url)) {
        seen.add(normalized.apply_url);
        jobs.push(normalized);
      }
    }

    start += page.positions.length;
    if (!page.positions.length || start >= totalCount) break;
  }

  return { jobs, totalCount };
}

async function scrapeHsbcJobs(query = '', location = '', fullSync = false, options = {}) {
  const signal = options?.signal || null;
  const maxJobs = Number(options?.maxJobs) > 0 ? Number(options.maxJobs) : 100;
  const { jobs, totalCount } = await fetchAllSearchJobs(maxJobs, signal, options?.fetchPage || fetchSearchPage);
  const recentJobs = filterJobsWithinRecentCutoff(jobs, { includeUnknownDate: true });
  const eligibleJobs = recentJobs.filter(shouldSaveJob);

  if (options?.dryRun === true || process.env.HSBC_DRY_RUN === 'true') {
    return {
      result: eligibleJobs,
      stats: { pageCount: Math.ceil(jobs.length / DEFAULT_PAGE_SIZE), listingJobsFetched: jobs.length, recentJobs: recentJobs.length, totalFound: totalCount },
    };
  }

  const company = await ensureCompany({ name: SOURCE });
  if (!company) throw new Error('ensureCompany returned no company row for HSBC');

  const applyUrls = recentJobs.map((job) => job.apply_url).filter(Boolean);
  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const allSourceResp = await getAllJobsBySource(SOURCE);
  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(
    recentJobs,
    existingResp.data || [],
    allSourceResp.data || []
  );
  const newEligibleJobs = newJobs.filter(shouldSaveJob);
  if (newEligibleJobs.length) await saveNewJobs({ enriched: newEligibleJobs }, saveJobs, logger);
  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  return {
    result: eligibleJobs,
    stats: {
      pageCount: Math.ceil(jobs.length / DEFAULT_PAGE_SIZE),
      listingJobsFetched: jobs.length,
      recentJobs: recentJobs.length,
      skippedOld: jobs.length - recentJobs.length,
      totalFound: totalCount,
      newCount: newEligibleJobs.length,
      updatedCount: updates.length,
      removedCount: removedApplyUrls.length,
      stopReason: signal?.aborted ? 'timeout' : 'completed normally',
    },
  };
}

module.exports = { buildSearchUrl, normalizeJob, fetchSearchPage, fetchAllSearchJobs, scrapeHsbcJobs };