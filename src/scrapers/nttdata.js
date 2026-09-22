'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'NTT DATA';
const SEARCH_URL = 'https://careers.nttdata.com/global/en/search-results';
const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 3;

function normalizeJob(job) {
  if (!job || !job.jobId || !job.title || !job.applyUrl) return null;
  const title = String(job.title).replace(/\s+/g, ' ').trim();
  const location = job.location ? String(job.location).replace(/\s+/g, ' ').trim() : null;
  return {
    positionId: String(job.jobId),
    title,
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location,
    country: job.country || (/\bIndia\b/i.test(location || '') ? 'India' : null),
    work_mode: null,
    posted_date: job.postedDate || null,
    description: job.description || null,
    apply_url: job.applyUrl,
    applyUrl: job.applyUrl,
    status: 'open',
    is_active: true,
  };
}

async function fetchSearchPage(page, offset, signal = null) {
  if (signal?.aborted) throw new Error('NTT DATA scraper timed out');
  await page.goto(`${SEARCH_URL}?from=${offset}`, {
    waitUntil: 'domcontentloaded',
    timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || 120000),
  });
  await page.waitForSelector('a[href*="/job/"]', { timeout: 30000 });
  await page.waitForTimeout(1000);
  return page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/job/"]')).map((link) => {
    const card = link.closest('li, article') || link.parentElement;
    const text = card?.innerText?.replace(/\s+/g, ' ').trim() || '';
    const locationMatch = text.match(/Location\s+(.+?)(?=Category|Job Type|Apply now|$)/i);
    const applyUrl = Array.from(card?.querySelectorAll('a[href*="/hvhapply?"]') || [])[0]?.href || null;
    const jobId = link.href.match(/\/job\/([^/]+)/i)?.[1] || null;
    return {
      jobId,
      title: link.textContent?.replace(/\s+/g, ' ').trim() || '',
      location: locationMatch?.[1]?.trim() || null,
      country: /\bIndia\b/i.test(locationMatch?.[1] || '') ? 'India' : null,
      description: text.replace(link.textContent || '', '').replace(/Apply now.*$/i, '').trim() || null,
      applyUrl,
    };
  }).filter((job) => job.jobId && job.title && job.applyUrl));
}

async function scrapeNttDataJobs(query = '', location = '', fullSync = false, options = {}) {
  const page = await newPage();
  const seen = new Set();
  const allJobs = [];
  const maxPages = Number(options.maxPages || process.env.NTTDATA_MAX_PAGES || (fullSync ? 300 : DEFAULT_MAX_PAGES));
  try {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const jobs = await fetchSearchPage(page, pageIndex * PAGE_SIZE, options.signal);
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
        stopReason: options.signal?.aborted ? 'timeout' : 'completed normally',
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { normalizeJob, fetchSearchPage, scrapeNttDataJobs };