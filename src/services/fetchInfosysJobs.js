'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { deduplicateJobs } = require('./duplicateService');
const { ensureCompany } = require('../database/companyRepository');
const infosysConfig = require('../config/infosys');

function normalizeTimestamp(rawValue) {
  if (!rawValue && rawValue !== 0) return null;
  const parsedDate = new Date(rawValue);
  return Number.isNaN(parsedDate.valueOf()) ? null : parsedDate.toISOString();
}

function stripHtml(value) {
  if (!value) return null;
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeExperience(minExperience, maxExperience) {
  const min = Number(minExperience);
  const max = Number(maxExperience);
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}-${max} years`;
  if (Number.isFinite(min)) return `${min}+ years`;
  if (Number.isFinite(max)) return `${max} years`;
  return null;
}

function resolveInfosysApplyUrl(job) {
  const fields = [
    'applyUrl', 'apply_url', 'jobUrl', 'job_url', 'postingUrl', 'posting_url',
    'jobDetailUrl', 'job_detail_url', 'externalUrl', 'external_url',
    'requisitionUrl', 'requisition_url', 'url', 'navigationUrl', 'navigation_url',
  ];
  for (const field of fields) {
    const value = String(job?.[field] || '').trim();
    if (value && /^https?:\/\//i.test(value)) return value;
  }

  const referenceCode = String(job?.referenceCode || job?.reference_code || '').trim();
  if (referenceCode) {
    return `${infosysConfig.APPLY_BASE_URL.replace(/\/jobs\/?$/i, '/jobdesc')}?jobReferenceCode=${encodeURIComponent(referenceCode)}`;
  }

  return infosysConfig.APPLY_BASE_URL || null;
}

function normalizeInfosysJob(job, companyName) {
  if (!job || typeof job !== 'object') return null;
  const postingId = job.postingId || job.posting_id || job.id || null;
  const title = String(job.postingTitle || job.title || '').trim() || null;
  const location = String(job.location || '').trim() || null;
  const description = [
    job.rolesResponsibilities,
    job.postingDescription,
    job.technicalRequirement,
    job.additionalResponsibility,
    job.preferredSkills,
    job.skills,
  ].filter(Boolean).map(stripHtml).filter(Boolean).join(' ').trim() || null;

  if (!postingId || !title) return null;
  const applyUrl = resolveInfosysApplyUrl(job);
  return {
    title,
    company_name: companyName,
    company: companyName,
    location,
    experience: normalizeExperience(job.minExperienceLevel, job.maxExperienceLevel),
    employment_type: null,
    work_mode: null,
    salary: null,
    description,
    summary: description,
    skills: job.preferredSkills || job.skills || null,
    apply_url: applyUrl,
    applyUrl,
    source: infosysConfig.SOURCE,
    posted_date: normalizeTimestamp(job.createdOn || job.createdAt || job.postedDate),
    expiry_date: normalizeTimestamp(job.expiryDate),
    status: 'active',
    is_active: true,
    external_job_id: String(postingId),
  };
}

function createEmptyStats() {
  return { fetched: 0, normalized: 0, unique: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, jobs: [] };
}

async function fetchInfosysSearchPage(pageNumber, pageSize) {
  const response = await axios.get(infosysConfig.SEARCH_ENDPOINT, {
    params: {
      sourceId: infosysConfig.SOURCE_IDS,
      searchText: infosysConfig.SEARCH_TEXT,
      pageNumber,
      pageSize,
    },
    headers: {
      'User-Agent': infosysConfig.USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://career.infosys.com/jobs?countrycode=IN&companyhiringtype=IL',
      Origin: 'https://career.infosys.com',
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (response.status !== 200 || !response.data) throw new Error(`Infosys gateway returned ${response.status}`);
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchInfosysJobs() {
  const stats = createEmptyStats();
  const allNormalizedJobs = [];
  const seenPostingIds = new Set();
  const pageSize = infosysConfig.PAGE_SIZE;
  let hasLoggedRawJobSample = false;

  for (let pageNumber = 1; ; pageNumber += 1) {
    const jobs = await fetchInfosysSearchPage(pageNumber, pageSize);
    if (!jobs.length) break;
    stats.fetched += jobs.length;
    if (!hasLoggedRawJobSample) {
      hasLoggedRawJobSample = true;
      logger.info(`Infosys raw job sample: ${JSON.stringify(jobs[0], null, 2)}`);
    }

    const newPageJobs = [];
    for (const job of jobs) {
      const normalizedJob = normalizeInfosysJob(job, infosysConfig.COMPANY_NAME);
      if (!normalizedJob) {
        stats.skipped += 1;
        continue;
      }
      const postingId = String(normalizedJob.external_job_id || '').trim();
      if (!postingId || seenPostingIds.has(postingId)) {
        stats.skipped += 1;
        continue;
      }
      seenPostingIds.add(postingId);
      newPageJobs.push(normalizedJob);
    }
    stats.normalized += newPageJobs.length;
    stats.skipped += jobs.length - newPageJobs.length;
    if (!newPageJobs.length) break;
    allNormalizedJobs.push(...newPageJobs);
    if (jobs.length < pageSize) break;
  }

  if (!allNormalizedJobs.length) return stats;
  const dedupeResult = await deduplicateJobs(allNormalizedJobs);
  stats.skipped += dedupeResult.duplicateCount || 0;
  stats.unique = (dedupeResult.uniqueJobs || []).length;
  stats.jobs = dedupeResult.uniqueJobs || [];
  return stats;
}

async function importInfosysJobs() {
  try {
    await ensureCompany({ name: infosysConfig.COMPANY_NAME, enabled: true, career_url: 'https://careers.infosys.com/' });
  } catch (error) {
    logger.error(`Infosys ensureCompany failed: ${error.message}`);
  }

  try {
    const stats = await fetchInfosysJobs();
    return {
      total_fetched: stats.fetched,
      total_normalized: stats.normalized,
      total_inserted: stats.inserted || 0,
      total_updated: stats.updated || 0,
      total_skipped: stats.skipped,
      total_failed: stats.failed,
      jobs: stats.jobs || [],
    };
  } catch (error) {
    logger.error(`Infosys import failed: ${error.message}`);
    return { total_fetched: 0, total_normalized: 0, total_inserted: 0, total_updated: 0, total_skipped: 0, total_failed: 1, jobs: [] };
  }
}

module.exports = { normalizeInfosysJob, fetchInfosysJobs, importInfosysJobs };
