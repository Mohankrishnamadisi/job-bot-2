'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'Deloitte';
const SEARCH_URL = 'https://apply.deloitte.com/en_US/careers/SearchJobs';
const PAGE_SIZE = 10;
const MAX_PAGES = 2;

function normalizeJob(job) {
  if (!job || typeof job !== 'object' || !job.href || !job.title) return null;
  return {
    positionId: job.positionId || job.href.match(/\/([0-9]+)(?:\?|$)/)?.[1] || null,
    title: String(job.title).replace(/\s+/g, ' ').trim(),
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location: job.location ? String(job.location).replace(/\s+/g, ' ').trim() : null,
    country: job.country || null,
    work_mode: null,
    posted_date: job.postedDate || job.posted_date || null,
    description: null,
    apply_url: job.href,
    applyUrl: job.href,
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(page, offset, signal = null) {
  if (signal?.aborted) throw new Error('Deloitte scraper timed out');
  const url = `${SEARCH_URL}/?jobRecordsPerPage=${PAGE_SIZE}&jobOffset=${offset}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/careers/JobDetail/"]'))
    .map((anchor) => {
      const href = anchor.href || '';
      const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || '';
      const item = anchor.closest('li, article, .job, .job-item, tr, div');
      const text = item?.textContent?.replace(/\s+/g, ' ').trim() || '';
      const location = text.replace(title, '').replace(/\s+/g, ' ').trim() || null;
      return { href, title, location };
    })
    .filter((job) => job.title && job.href));
}

async function scrapeDeloitteJobs(query = '', location = '', fullSync = false, options = {}) {
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

module.exports = { normalizeJob, scrapeDeloitteJobs };