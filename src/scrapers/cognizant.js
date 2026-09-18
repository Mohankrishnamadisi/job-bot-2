'use strict';

const { chromium } = require('playwright');
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

const SOURCE = 'Cognizant';
const SEARCH_URL = 'https://careers.cognizant.com/global-en/jobs/';
const SEARCH_RETRY_MAX = 3;
const SEARCH_RETRY_BASE_MS = 1000;
const DETAIL_CONCURRENCY = Number(process.env.COGNIZANT_DETAIL_CONCURRENCY || process.env.DETAIL_PAGE_CONCURRENCY || 2);
const DETAIL_TIMEOUT_MS = Number(process.env.COGNIZANT_DETAIL_TIMEOUT_MS || process.env.DETAIL_PAGE_TIMEOUT_MS || 30000);

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) return Math.max(timestamp - Date.now(), 0);
  return null;
}

function buildAbsoluteUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://careers.cognizant.com${trimmed}`;
  return `https://careers.cognizant.com/${trimmed}`;
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;

  const href = job.href || job.apply_url || job.applyUrl || job.url || null;
  const applyUrl = buildAbsoluteUrl(href);
  const title = job.title || job.name || job.jobTitle || null;
  const rawLocation = job.location || job.loc || job.workLocation || null;
  const description = job.description || job.summary || null;
  const positionId = job.positionId || job.id || job.jobId || null;

  return {
    positionId,
    title,
    source: SOURCE,
    company: SOURCE,
    location: rawLocation || null,
    country: job.country || null,
    work_mode: job.work_mode || job.workMode || null,
    posted_date: job.posted_date || job.postedDate || null,
    description,
    apply_url: applyUrl,
    employment_type: job.employment_type || job.employmentType || null,
    experience: job.experience || null,
    salary: job.salary || null,
    skills: Array.isArray(job.skills) ? job.skills : [],
    status: 'open',
    is_active: true,
  };
}

function extractJobs(responseData) {
  if (!Array.isArray(responseData)) return [];

  return responseData
    .map((job) => normalizeJob({
      title: job?.title || null,
      href: job?.href || null,
      location: job?.meta || job?.location || null,
      description: job?.description || null,
      posted_date: job?.posted_date || job?.postedDate || null,
    }))
    .filter(Boolean);
}

async function fetchSearchPage(browser, signal = null, activePages = new Set()) {
  let page;
  let closeOnAbort;

  try {
    if (signal?.aborted) throw new Error('Cognizant scraper timed out');
    page = await browser.newPage();
    activePages.add(page);

    closeOnAbort = () => page?.close().catch(() => {});
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);

    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: Number(process.env.COMPANY_SCRAPER_TIMEOUT_MS || process.env.SCRAPER_TIMEOUT_MS || 120000) });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(6000);

    const result = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      return anchors
        .map((anchor) => {
          const href = anchor.href || null;
          const text = anchor.textContent?.replace(/\s+/g, ' ').trim() || null;
          const isJobLink = /\/global-en\/jobs\/[^/]+\/[^/]+\/?$/i.test(href) || /\/global-en\/jobs\/\d+\//i.test(href);
          if (!href || !isJobLink || !text) return null;
          return { title: text, href };
        })
        .filter(Boolean);
    });

    return result;
  } finally {
    if (closeOnAbort) {
      signal?.removeEventListener('abort', closeOnAbort);
    }
    if (page) {
      activePages.delete(page);
    }
    await page?.close().catch(() => {});
  }
}

async function fetchSearchPageWithRetries(browser, signal = null, activePages = new Set()) {
  for (let attempt = 1; attempt <= SEARCH_RETRY_MAX; attempt += 1) {
    try {
      if (signal?.aborted) throw new Error('Cognizant scraper timed out');
      const data = await fetchSearchPage(browser, signal, activePages);
      return { data, error: null };
    } catch (error) {
      if (signal?.aborted) {
        return { data: null, error: new Error('Cognizant scraper timed out') };
      }
      const status = error?.response?.status;
      const retryAfterMs = parseRetryAfter(error?.response?.headers?.['retry-after']);

      if (status === 429) {
        const waitMs = retryAfterMs != null ? retryAfterMs : SEARCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(`Cognizant waiting ${Math.round(waitMs / 1000)} seconds due to rate limit...`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, waitMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Cognizant scraper timed out'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        logger.info('Cognizant retrying search page...');
        if (attempt >= SEARCH_RETRY_MAX) {
          return { data: null, error };
        }
        continue;
      }

      return { data: null, error };
    }
  }

  return { data: null, error: new Error('Cognizant search page retry limit exceeded') };
}

async function fetchAllSearchJobs(browser, fullSync = false, signal = null, activePages = new Set()) {
  const allJobs = [];
  const seen = new Set();
  const pageLimit = fullSync ? Number.MAX_SAFE_INTEGER : 1;

  for (let page = 1; page <= pageLimit; page += 1) {
    if (signal?.aborted) break;
    const { data, error } = await fetchSearchPageWithRetries(browser, signal, activePages);
    if (error) {
      logger.warn(`Cognizant skipped search page ${page} after repeated failures.`);
      break;
    }

    const pageJobs = extractJobs(data);
    logger.info(`Cognizant page ${page} returned ${pageJobs.length} jobs.`);

    if (!pageJobs.length) break;

    const uniquePageJobs = pageJobs.filter((job) => {
      const key = job.apply_url || job.positionId || job.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (let index = 0; index < uniquePageJobs.length; index += DETAIL_CONCURRENCY) {
      const chunk = uniquePageJobs.slice(index, index + DETAIL_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(async (job) => {
        const url = job.apply_url || job.href || job.href;
        if (!url || signal?.aborted) return job;

        let pageInstance = null;
        const timer = setTimeout(() => {
          if (pageInstance) {
            pageInstance.close().catch(() => {});
          }
        }, DETAIL_TIMEOUT_MS);
        const closeOnAbort = () => pageInstance?.close().catch(() => {});
        signal?.addEventListener('abort', closeOnAbort, { once: true });

        try {
          pageInstance = await browser.newPage();
          activePages.add(pageInstance);
          pageInstance.setDefaultTimeout(DETAIL_TIMEOUT_MS);
          pageInstance.setDefaultNavigationTimeout(DETAIL_TIMEOUT_MS);
          await pageInstance.goto(url, { waitUntil: 'domcontentloaded', timeout: DETAIL_TIMEOUT_MS });
          await pageInstance.waitForLoadState('networkidle').catch(() => {});
          await pageInstance.waitForTimeout(2000);

          const details = await pageInstance.evaluate(() => {
            const out = {};
            const locNode = document.querySelector('li.job-meta-item.job-meta-location strong a');
            if (locNode) out.location = locNode.textContent?.trim() || null;

            const metaItems = Array.from(document.querySelectorAll('li.job-meta-item'));
            for (const item of metaItems) {
              const label = item.childNodes[0]?.textContent?.trim() || '';
              const value = item.querySelector('strong')?.textContent?.trim() || null;
              if (/employment|contract|employment type/i.test(label) && value) {
                out.employment_type = value;
                break;
              }
              if (!out.employment_type && /work model/i.test(label) && value) {
                out.employment_type = value;
              }
              if (!out.experience && /experience/i.test(label) && value) {
                out.experience = value;
              }
            }

            if (!out.experience) {
              const detailNode = document.querySelector('#js-job-detail, .container.job-detail, article.cms-content');
              if (detailNode) {
                const expNode = Array.from(detailNode.querySelectorAll('*')).find((n) => /experience/i.test(n.textContent || ''));
                if (expNode) out.experience = expNode.textContent.trim().slice(0, 200);
              }
            }

            const jsonLd = (() => {
              try {
                const s = document.querySelector('script[type="application/ld+json"]#js-job-posting');
                if (s) return JSON.parse(s.textContent || 'null');
              } catch (e) {}
              return null;
            })();

            if (jsonLd && jsonLd.description) out.description = jsonLd.description;
            if (jsonLd && (jsonLd.datePosted || jsonLd.datePublished)) out.posted_date = jsonLd.datePosted || jsonLd.datePublished;
            if (!out.description) {
              const article = document.querySelector('article.cms-content, div.container.job-detail');
              if (article) out.description = article.innerHTML.slice(0, 20000);
            }

            return out;
          });

          if (details.location) job.location = details.location;
          if (details.employment_type) job.employment_type = details.employment_type;
          if (details.experience) job.experience = details.experience;
          if (details.description) job.description = details.description;
          if (details.posted_date) job.posted_date = details.posted_date;
          return job;
        } catch (error) {
          logger.warn(`Cognizant detail page failed for ${url}: ${error.message}`);
          return job;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', closeOnAbort);
          if (pageInstance) {
            activePages.delete(pageInstance);
          }
          await pageInstance?.close().catch(() => {});
        }
      }));

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn(`Cognizant detail batch rejected: ${result.reason?.message || result.reason}`);
        }
      }
    }

    allJobs.push(...filterJobsWithinRecentCutoff(uniquePageJobs, { includeUnknownDate: true }));
    break;
  }

  return {
    allJobs,
    pageCount: 1,
    totalCount: allJobs.length,
  };
}

async function scrapeCognizantJobs(query = '', location = '', fullSync = false, options = {}) {
  const dryRun = options?.dryRun === true || process.env.COGNIZANT_DRY_RUN === 'true';
  logger.info('Scraping started');
  const callSignal = options?.signal || null;
  const activePages = new Set();
  let browser;
  let browserClosed = false;

  const closeBrowserOnce = async () => {
    if (browser && !browserClosed) {
      browserClosed = true;
      await browser.close().catch(() => {});
    }
  };

  if (callSignal) {
    callSignal.addEventListener('abort', async () => {
      for (const page of Array.from(activePages)) {
        await page.close().catch(() => {});
        activePages.delete(page);
      }
      await closeBrowserOnce();
    }, { once: true });
  }

  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-http2'] });
    const { allJobs, pageCount, totalCount } = await fetchAllSearchJobs(browser, fullSync, callSignal, activePages);
    const recentJobs = filterJobsWithinRecentCutoff(allJobs, { includeUnknownDate: true });

    logger.info(`Jobs fetched: ${allJobs.length}`);

    if (dryRun) {
      logger.info('Cognizant dry run enabled; skipping database writes.');
      return {
        result: recentJobs,
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
      throw new Error('ensureCompany returned no company row for Cognizant');
    }

    const applyUrls = recentJobs.map((job) => job.apply_url).filter(Boolean);
    const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
    const existingRows = existingResp.data || [];
    const allSourceResp = await getAllJobsBySource(SOURCE);
    const allSourceRows = allSourceResp.data || [];

    const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(recentJobs, existingRows, allSourceRows);

    logger.info(`Cognizant found ${newJobs.length} new, ${existingMatches.length} existing, ${removedRows.length} removed (source total ${allSourceRows.length})`);

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
      logger.error(`Cognizant enrichment failed: ${error.message}`);
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
  } finally {
    for (const page of Array.from(activePages)) {
      await page.close().catch(() => {});
      activePages.delete(page);
    }
    await closeBrowserOnce();
  }
}

module.exports = {
  normalizeJob,
  scrapeCognizantJobs,
};
