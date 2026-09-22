'use strict';

const { newPage } = require('./browser');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SOURCE = 'LTIMindtree';
const SEARCH_URL = 'https://ltimindtree.ripplehire.com/candidate/?token=xviyQvbnyYZdGtozXoNm&lang=en&source=CAREERSITE#list';
const INDIA_SEARCH_URL = `${SEARCH_URL}/geo=India`;
const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 110;

function normalizeJob(job) {
  if (!job || !job.jobId || !job.title || !job.applyUrl) return null;
  const location = job.location ? String(job.location).replace(/\s+/g, ' ').trim() : null;
  return {
    positionId: String(job.jobId),
    title: String(job.title).replace(/\s+/g, ' ').trim(),
    company: SOURCE,
    company_name: SOURCE,
    source: SOURCE,
    location,
    country: job.country || (/\bIndia\b/i.test(location || '') ? 'India' : null),
    work_mode: null,
    posted_date: null,
    description: job.description || null,
    apply_url: job.applyUrl,
    applyUrl: job.applyUrl,
    employment_type: null,
    experience: job.experience || null,
    salary: null,
    skills: [],
    status: 'open',
    is_active: true,
  };
}

async function readRenderedJobs(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('a[href*="#detail/job/"]')).map((link) => {
    const card = link.closest('li') || link.parentElement;
    const text = card?.innerText?.replace(/\s+/g, ' ').trim() || '';
    const jobId = link.href.match(/#detail\/job\/([^/?#]+)/i)?.[1] || null;
    const location = card?.querySelector('.location-text')?.innerText?.replace(/\s+/g, ' ').trim() || null;
    const experience = text.match(/\d+\s*-\s*\d+\s+Years/i)?.[0] || null;
    return {
      jobId,
      title: link.textContent?.replace(/\s+/g, ' ').trim() || '',
      experience,
      location: location === 'Select Location' ? null : location,
      description: null,
      applyUrl: link.href,
    };
  }).filter((job) => job.jobId && job.title));
}

async function scrapeLtimindtreeJobs(query = '', location = '', fullSync = false, options = {}) {
  const page = await newPage();
  const seen = new Set();
  const allJobs = [];
  const maxPages = Number(options.maxPages || process.env.LTIMINDTREE_MAX_PAGES || DEFAULT_MAX_PAGES);
  const searchUrl = /india/i.test(location || '') ? INDIA_SEARCH_URL : SEARCH_URL;
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('a[href*="#detail/job/"]', { timeout: 30000 });
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (options.signal?.aborted) throw new Error('LTIMindtree scraper timed out');
      const jobs = await readRenderedJobs(page);
      for (const job of jobs.map(normalizeJob).filter(Boolean)) {
        if (/india/i.test(location || '')) job.country = 'India';
        if (!seen.has(job.apply_url)) {
          seen.add(job.apply_url);
          allJobs.push(job);
        }
      }
      if (jobs.length < PAGE_SIZE) break;
      const before = jobs.length;
      const viewMore = page.getByText('View more', { exact: true }).first();
      if (!(await viewMore.count()) || !(await viewMore.isVisible().catch(() => false))) break;
      await viewMore.click();
      await page.waitForFunction((count) => document.querySelectorAll('a[href*="#detail/job/"]').length > count, before, { timeout: 30000 }).catch(() => {});
      if ((await readRenderedJobs(page)).length <= before) break;
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

module.exports = { normalizeJob, scrapeLtimindtreeJobs };