'use strict';

const axios = require('axios');
const logger = require('../../utils/logger');
const supabase = require('../../database/supabaseClient');
const { filterRecentJobs } = require('../../utils/jobDateFilter');
const { arbeitnowRetentionDays } = require('../../config/env');

const ARBEITNOW_API_URL = 'https://www.arbeitnow.com/api/job-board-api';
const DEFAULT_MAX_PAGES = 5;

function resolveMaxPages(maxPages) {
  const parsed = Number(maxPages ?? process.env.ARBEITNOW_MAX_PAGES ?? process.env.ARBEITNOW_MAX_PAGE_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_PAGES;
  }

  return Math.floor(parsed);
}

function normalizeWorkMode(job) {
  if (job?.remote === true) {
    return 'remote';
  }

  if (job?.remote === false) {
    return 'onsite';
  }

  return job?.work_mode || null;
}

function normalizeEmploymentType(job) {
  if (Array.isArray(job?.job_types) && job.job_types.length > 0) {
    return job.job_types.join(', ');
  }

  if (job?.job_type) {
    return job.job_type;
  }

  return job?.employment_type || null;
}

function normalizeTimestamp(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return new Date(rawValue * 1000).toISOString();
  }

  if (typeof rawValue === 'string') {
    const parsedNumber = Number(rawValue);
    if (Number.isFinite(parsedNumber)) {
      return new Date(parsedNumber * 1000).toISOString();
    }

    const parsedDate = new Date(rawValue);
    if (!Number.isNaN(parsedDate.valueOf())) {
      return parsedDate.toISOString();
    }
  }

  return null;
}

function stripHtml(value) {
  if (!value) {
    return null;
  }

  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArbeitnowJob(job) {
  if (!job || typeof job !== 'object') {
    return null;
  }

  const description = stripHtml(job.description || job.summary || '');

  return {
    title: job.title || null,
    company_name: job.company_name || job.company || null,
    company: job.company_name || job.company || null,
    location: job.location || null,
    experience: job.experience || null,
    employment_type: normalizeEmploymentType(job),
    work_mode: normalizeWorkMode(job),
    salary: job.salary || null,
    description,
    summary: description,
    skills: Array.isArray(job.tags) && job.tags.length > 0 ? job.tags : null,
    apply_url: job.url || job.apply_url || job.applyUrl || null,
    source: 'arbeitnow',
    posted_date: normalizeTimestamp(job.created_at),
    expiry_date: null,
    status: 'active',
    is_active: true,
    external_job_id: job.slug || null,
  };
}

function buildDuplicateCheckKey(job) {
  const title = String(job?.title || '').trim().toLowerCase();
  const companyName = String(job?.company_name || job?.company || '').trim().toLowerCase();
  const applyUrl = String(job?.apply_url || job?.applyUrl || '').trim().toLowerCase();
  return `${title}|${companyName}|${applyUrl}`;
}

async function fetchExistingArbeitnowKeys() {
  const { data, error } = await supabase
    .from('raw_jobs')
    .select('id,title,apply_url,company_id');

  if (error) {
    logger.warn(`Unable to load existing jobs for duplicate detection: ${error.message}`);
    return new Set();
  }

  const jobs = data || [];
  const companyIds = jobs.map((job) => job.company_id).filter(Boolean);
  const companyNameMap = new Map();

  if (companyIds.length > 0) {
    const { data: companies, error: companyError } = await supabase
      .from('companies')
      .select('id,name')
      .in('id', companyIds);

    if (!companyError) {
      (companies || []).forEach((company) => {
        if (company?.id) {
          companyNameMap.set(company.id, company.name);
        }
      });
    }
  }

  return new Set(
    jobs.map((job) => {
      const companyName = companyNameMap.get(job.company_id) || '';
      return buildDuplicateCheckKey({
        title: job.title,
        company_name: companyName,
        apply_url: job.apply_url,
      });
    })
  );
}

async function fetchArbeitnowJobs(options = {}) {
  const maxPages = resolveMaxPages(options.maxPages);
  const stats = { fetched: 0, normalized: 0, unique: 0, skipped: 0, failed: 0, jobs: [] };
  const existingKeys = await fetchExistingArbeitnowKeys();
  const seenKeys = new Set();

  logger.info(`Starting Arbeitnow fetch with a page limit of ${maxPages}`);

  for (let page = 1; page <= maxPages; page += 1) {
    try {
      const response = await axios.get(ARBEITNOW_API_URL, {
        params: { page, limit: 100 },
        timeout: 30000,
      });

      const payload = response?.data || {};
      const jobs = Array.isArray(payload?.data) ? payload.data : [];
      stats.fetched += jobs.length;

      if (!jobs.length) {
        logger.info(`Arbeitnow fetch reached the end of available pages at page ${page}`);
        break;
      }

      logger.info(`Fetched ${jobs.length} Arbeitnow jobs from page ${page}`);

      const jobsToPersist = [];

      jobs.forEach((job) => {
        const normalizedJob = normalizeArbeitnowJob(job);
        if (!normalizedJob) {
          stats.failed += 1;
          return;
        }

        stats.normalized += 1;
        const duplicateKey = buildDuplicateCheckKey(normalizedJob);
        if (!duplicateKey || existingKeys.has(duplicateKey) || seenKeys.has(duplicateKey)) {
          stats.skipped += 1;
          return;
        }

        seenKeys.add(duplicateKey);
        jobsToPersist.push(normalizedJob);
      });

      if (!jobsToPersist.length) {
        continue;
      }

      const recentJobs = filterRecentJobs(jobsToPersist, arbeitnowRetentionDays);
      const oldJobsSkipped = jobsToPersist.length - recentJobs.length;
      stats.unique += recentJobs.length;
      stats.jobs.push(...recentJobs);
      stats.skipped += oldJobsSkipped;

      if (!payload?.links?.next) {
        logger.info('Arbeitnow API returned no additional pages');
        break;
      }
    } catch (error) {
      logger.error(`Arbeitnow fetch failed on page ${page}: ${error.message}`);
      stats.failed += 1;
      break;
    }
  }

  logger.info(
    `Arbeitnow fetch completed: fetched=${stats.fetched}, recent=${stats.unique}, skipped old=${stats.skipped}, failed=${stats.failed}`
  );

  return stats;
}

async function importArbeitnowJobs(options = {}) {
  const result = await fetchArbeitnowJobs(options);
  return {
    ...result,
    total_fetched: result.fetched,
    total_normalized: result.normalized,
    total_unique: result.unique,
    total_skipped: result.skipped,
    total_failed: result.failed,
    jobs: result.jobs,
  };
}

module.exports = {
  importArbeitnowJobs,
  fetchArbeitnowJobs,
  normalizeArbeitnowJob,
  buildDuplicateCheckKey,
};
