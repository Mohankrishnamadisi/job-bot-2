'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'Cisco';
const SEARCH_URL = 'https://careers.cisco.com/global/en/search-results';
const PAGE_SIZE = 10;
const MAX_PAGES = 2;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeJob(job) {
  if (!job || !job.jobId || !job.title) return null;
  const title = String(job.title).replace(/\s+/g, ' ').trim();
  const applyUrl = job.apply_url || `https://careers.cisco.com/global/en/job/${job.jobId}/${slugify(title)}`;
  return {
    positionId: String(job.jobId),
    title,
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location: job.cityState || job.location || null,
    country: job.country || null,
    work_mode: null,
    posted_date: job.postedDate || job.dateCreated || null,
    description: null,
    apply_url: applyUrl,
    applyUrl: applyUrl,
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(page, offset, signal = null) {
  if (signal?.aborted) throw new Error('Cisco scraper timed out');
  const url = `${SEARCH_URL}?from=${offset}&s=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return page.evaluate(() => {
    const pageIsIndia = /\bIndia\b/i.test(document.body.innerText || '');
    return Array.from(document.querySelectorAll('a[href*="/job/"]'))
      .map((link) => ({
        jobId: link.href.match(/\/job\/(\d+)/i)?.[1] || null,
        title: link.textContent?.replace(/\s+/g, ' ').trim() || '',
        cityState: null,
        country: pageIsIndia ? 'India' : null,
      }))
      .filter((job) => job.jobId && job.title);
  });
}

async function scrapeCiscoJobs(query = '', location = '', fullSync = false, options = {}) {
  const page = await newPage();
  const seen = new Set();
  const allJobs = [];
  try {
    for (let pageIndex = 0; pageIndex < (fullSync ? MAX_PAGES : 1); pageIndex += 1) {
      const jobs = await fetchSearchPage(page, pageIndex * PAGE_SIZE, options?.signal);
      if (!jobs.length) break;
      for (const job of jobs.map(normalizeJob).filter(Boolean)) {
        if (!seen.has(job.apply_url)) {
          seen.add(job.apply_url);
          allJobs.push(job);
        }
      }
      if (jobs.length < PAGE_SIZE) break;
    }
    const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });
    return {
      result: recentJobs,
      stats: {
        pageCount: Math.ceil(allJobs.length / PAGE_SIZE) || 1,
        listingJobsFetched: allJobs.length,
        recentJobs: recentJobs.length,
        skippedOld: allJobs.length - recentJobs.length,
        stopReason: options?.signal?.aborted ? 'timeout' : 'completed normally',
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { normalizeJob, scrapeCiscoJobs };