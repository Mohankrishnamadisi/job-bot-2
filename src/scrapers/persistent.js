'use strict';

const axios = require('axios');
const FormData = require('form-data');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'Persistent Systems';
const SEARCH_ENDPOINT = 'https://public.zwayam.com/jobs/search';
const CAREERS_URL = 'https://careers.persistent.com/jobview/';
const COMPANY_ID = 'MTYzNDQ=';
const PAGE_SIZE = 9;
const DEFAULT_MAX_PAGES = 3;

function normalizeJob(job) {
  const source = job?._source || job;
  if (!source || !source.newJobCode || !(source.jobTitle || source.title) || !source.jobUrl) return null;

  const title = String(source.jobTitle || source.title).replace(/\s+/g, ' ').trim();
  const location = source.locationDisplayForManageJobs || source.location || source.locationSeparatedbySlash || null;
  const applyUrl = /^https?:\/\//i.test(source.jobUrl) ? source.jobUrl : `${CAREERS_URL}${source.jobUrl}`;

  return {
    positionId: String(source.newJobCode),
    title,
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location: location ? String(location).replace(/\s+/g, ' ').trim() : null,
    country: /\bIndia\b/i.test(`${location || ''} ${source.text1 || ''}`) ? 'India' : source.country || null,
    work_mode: source.workMode || null,
    posted_date: source.postedDate || source.createdDate || null,
    description: source.mediumDescriptionWithoutHtml || source.description || null,
    apply_url: applyUrl,
    applyUrl,
    employment_type: source.employmentType || null,
    experience: source.minYearOfExperience != null ? `${source.minYearOfExperience}-${source.maxYrsOfExperience || source.minYearOfExperience} years` : null,
    salary: source.salary || null,
    skills: Array.isArray(source.desiredSkillList) ? source.desiredSkillList.filter(Boolean) : [],
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(page, signal = null) {
  if (signal?.aborted) throw new Error('Persistent Systems scraper timed out');

  const form = new FormData();
  form.append('filterCri', JSON.stringify({
    paginationStartNo: page * PAGE_SIZE,
    selectedCall: 'sort',
    sortCriteria: { name: 'modifiedDate', isAscending: false },
    anyOfTheseWords: '',
  }));
  form.append('domain', 'careers.persistent.com');
  form.append('companyId', COMPANY_ID);

  const response = await axios.post(SEARCH_ENDPOINT, form, {
    signal,
    timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || 120000),
    headers: { ...form.getHeaders(), Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  const data = response.data?.data || {};
  return { total: Number(data.totalCount || 0), jobs: Array.isArray(data.data) ? data.data : [] };
}

async function scrapePersistentJobs(query = '', location = '', fullSync = false, options = {}) {
  const seen = new Set();
  const allJobs = [];
  const maxPages = Number(options.maxPages || process.env.PERSISTENT_MAX_PAGES || (fullSync ? 100 : DEFAULT_MAX_PAGES));
  let total = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetchSearchPage(page, options.signal);
    total = response.total;
    for (const job of response.jobs.map(normalizeJob).filter(Boolean)) {
      if (!seen.has(job.apply_url)) {
        seen.add(job.apply_url);
        allJobs.push(job);
      }
    }
    if (!response.jobs.length || (page + 1) * PAGE_SIZE >= total) break;
  }

  const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });
  return {
    result: recentJobs,
    stats: {
      pageCount: Math.ceil(allJobs.length / PAGE_SIZE) || 1,
      listingJobsFetched: allJobs.length,
      totalFound: total,
      recentJobs: recentJobs.length,
      skippedOld: allJobs.length - recentJobs.length,
      stopReason: options.signal?.aborted ? 'timeout' : 'completed normally',
    },
  };
}

module.exports = { normalizeJob, fetchSearchPage, scrapePersistentJobs };