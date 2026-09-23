'use strict';

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'Mphasis';
const SEARCH_ENDPOINT = 'https://mphasis.ripplehire.com/candidate/candidatejobsearch';
const TOKEN = 'ty4DfyWddnOrtpclQeia';
const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 3;
const xmlParser = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'jobVoList' });

function normalizeJob(job) {
  if (!job || !job.jobId || !job.jobTitle) return null;
  const applyUrl = `https://mphasis.ripplehire.com/candidate/?token=${TOKEN}&source=CAREERSITE#detail/job/${job.jobSeq || job.jobId}`;
  const location = job.locations || job.jobLocation || null;
  return {
    positionId: String(job.jobId),
    title: String(job.jobTitle).replace(/\s+/g, ' ').trim(),
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location: location ? String(location).replace(/\s+/g, ' ').trim() : null,
    country: job.jobLocation || null,
    work_mode: null,
    posted_date: job.jobPostingDate || job.openDate || null,
    description: job.jobDesc || null,
    apply_url: applyUrl,
    applyUrl,
    employment_type: job.jobType || null,
    experience: job.jobReqExp || null,
    salary: null,
    skills: [],
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(page, signal = null) {
  if (signal?.aborted) throw new Error('Mphasis scraper timed out');
  const params = { page, search: '*:*', token: TOKEN, source: 'CAREERSITE', pagesize: PAGE_SIZE };
  const response = await axios.post(SEARCH_ENDPOINT, new URLSearchParams({
    careerSiteUrlParams: JSON.stringify(params),
    lang: 'en',
  }).toString(), {
    signal,
    timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || 120000),
    responseType: 'text',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
  });
  const parsedResponse = String(response.data || '').trim().startsWith('<')
    ? xmlParser.parse(response.data)?.JobPageVO
    : JSON.parse(response.data);
  const parsed = parsedResponse || {};
  const jobs = Array.isArray(parsed.jobVoList) ? parsed.jobVoList : parsed.jobVoList ? [parsed.jobVoList] : [];
  return { total: Number(parsed.totalJobCount || 0), jobs };
}

async function scrapeMphasisJobs(query = '', location = '', fullSync = false, options = {}) {
  const seen = new Set();
  const allJobs = [];
  const maxPages = Number(options.maxPages || process.env.MPHASIS_MAX_PAGES || (fullSync ? 100 : DEFAULT_MAX_PAGES));
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

module.exports = { normalizeJob, fetchSearchPage, scrapeMphasisJobs };