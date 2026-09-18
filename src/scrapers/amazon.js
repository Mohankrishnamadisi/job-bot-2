const axios = require('axios');
const logger = require('../utils/logger');
const { newPage } = require('./browser');
const {
  getJobsBySourceAndApplyUrls,
  saveJobs,
  updateJobs,
  markJobsInactive,
  getAllJobsBySource,
} = require('../database/jobRepository');
const {
  delay,
  parseEmploymentType,
  extractExperience,
  extractSalary,
  extractWorkMode,
  extractSkillsFromText,
  chunkArray,
} = require('../parsers/common/jobHelpers');
const { isIndiaJob, isRemoteJob, shouldSaveJob } = require('../parsers/common/jobFilters');
const {
  findJobsForSync,
  buildJobUpdates,
  saveNewJobs,
  updateExistingJobs,
  markRemovedJobs,
} = require('../parsers/common/jobSyncService');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const DETAIL_CONCURRENCY = Number(process.env.AMAZON_DETAIL_CONCURRENCY || process.env.DETAIL_PAGE_CONCURRENCY || 2);
const DETAIL_DELAY_MIN_MS = 300;
const DETAIL_DELAY_MAX_MS = 500;
const DETAIL_TIMEOUT_MS = Number(process.env.AMAZON_DETAIL_TIMEOUT_MS || process.env.DETAIL_PAGE_TIMEOUT_MS || 30000);
const SOURCE = 'Amazon';
const SEARCH_URL = "https://www.amazon.jobs/en/search?base_query=Software&loc_query=India";
const RETRY_MAX = 3;
const RETRY_BACKOFF_MS = [2000, 5000, 10000];
const PAGINATION_DELAY_MIN_MS = 1500;
const PAGINATION_DELAY_MAX_MS = 3000;
const AMAZON_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES_PER_RUN = 5;
const DEFAULT_MAX_JOBS_PER_RUN = 100;
const DEFAULT_SCRAPER_TIMEOUT_MS = 120000;

function getPositiveEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mergeAbortSignals(...signals) {
  const validSignals = signals.filter((signal) => signal && typeof signal === 'object');
  if (!validSignals.length) return null;

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(validSignals);
  }

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const signal of validSignals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }

  return controller.signal;
}

function createScrapeContext(externalSignal = null) {
  const controller = new AbortController();
  const maxPages = getPositiveEnvNumber('MAX_PAGES_PER_COMPANY', DEFAULT_MAX_PAGES_PER_RUN);
  const maxJobs = getPositiveEnvNumber('MAX_JOBS_PER_COMPANY_RUN', DEFAULT_MAX_JOBS_PER_RUN);
  const timeoutMs = getPositiveEnvNumber('COMPANY_SCRAPER_TIMEOUT_MS', getPositiveEnvNumber('SCRAPER_TIMEOUT_MS', DEFAULT_SCRAPER_TIMEOUT_MS));
  const context = { controller, signal: controller.signal, maxPages, maxJobs, stopReason: null };

  if (externalSignal) {
    const externalAbortHandler = () => {
      if (!controller.signal.aborted) {
        context.stopReason = 'timed out';
        controller.abort();
      }
    };
    if (externalSignal.aborted) {
      externalAbortHandler();
    } else {
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }

  context.timeout = setTimeout(() => {
    context.stopReason = 'timed out';
    controller.abort();
  }, timeoutMs);

  return context;
}

function stopError(message = 'Amazon scraper stopped') {
  const error = new Error(message);
  error.name = 'ScraperStoppedError';
  return error;
}

function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(stopError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(stopError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) return Math.max(timestamp - Date.now(), 0);
  return null;
}

function normalizePostedDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString();
}

async function scrapeJobDetailPage(applyUrl, signal) {
  if (!applyUrl) return { bodyText: null, ldJsonScripts: [], topSkills: [] };

  let page;
  const closeOnAbort = () => page?.close().catch(() => {});
  try {
    if (signal?.aborted) throw stopError();
    page = await newPage();
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: DETAIL_TIMEOUT_MS, signal });

    const [bodyText, ldJsonScripts, topSkills] = await Promise.all([
      page.evaluate(() => document.body.innerText),
      page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((node) => node.textContent || '')),
      page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll('*')).find((el) => el.innerText && el.innerText.trim().toLowerCase() === 'top skills');
        if (!heading) return [];
        const section = heading.parentElement || heading;
        const lines = section.innerText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const startIndex = lines.findIndex((line) => /^top skills$/i.test(line));
        if (startIndex === -1) return [];
        return lines.slice(startIndex + 1).filter((line) => !/^(Previously worked as|Insights from previous hires|Powered by|This site|Job description|Company and benefits|Job number|Date posted|Work site|Travel|Profession|Discipline|Role type|Employment type)$/i.test(line));
      }),
    ]);

    return { bodyText, ldJsonScripts, topSkills };
  } catch (error) {
    logger.warn(`Playwright detail scrape failed for ${applyUrl}: ${error.message}`);
    return { bodyText: null, ldJsonScripts: [], topSkills: [] };
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function normalizeDetails(data, applyUrl, signal) {
  if (!data || typeof data !== 'object') return {};

  const apiDescription =
    data.description ||
    data.description_short ||
    data.jobDescription ||
    data.job_description ||
    null;
  const publicUrl = data.publicUrl || data.public_url || null;
  const apiEmploymentType = data.job_schedule_type || data.employmentType || data.employment_type || null;
  const details = {
    description: apiDescription,
    publicUrl,
    employment_type: parseEmploymentType(apiEmploymentType),
    experience: extractExperience(apiDescription || ""),
    salary: extractSalary(apiDescription || ""),
    skills: [],
    work_mode: "onsite",
  };

  const pageDetails = await scrapeJobDetailPage(applyUrl, signal);

  for (const rawJson of pageDetails.ldJsonScripts) {
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      if (!details.employment_type && parsed.employmentType) {
        details.employment_type = parseEmploymentType(parsed.employmentType);
      }
      if (!details.experience && parsed.description) {
        details.experience = extractExperience(parsed.description);
      }
      if (!details.salary && parsed.description) {
        details.salary = extractSalary(parsed.description);
      }
    } catch (error) {
      // ignore invalid JSON blocks
    }
  }

  if ((!details.skills || !details.skills.length) && pageDetails.topSkills.length) {
    details.skills = pageDetails.topSkills;
  }

  if ((!details.skills || !details.skills.length) && pageDetails.bodyText) {
    details.skills = extractSkillsFromText(pageDetails.bodyText);
  }

  if (!details.experience && pageDetails.bodyText) {
    details.experience = extractExperience(pageDetails.bodyText);
  }

  if (!details.salary && pageDetails.bodyText) {
    details.salary = extractSalary(pageDetails.bodyText);
  }

  details.work_mode = extractWorkMode(
    `${apiDescription || ""}\n${pageDetails.bodyText || ""}`
);

if (pageDetails.bodyText) {
    let body = pageDetails.bodyText;
    const start = body.search(/Description/i);
    if (start >= 0) {
        body = body.substring(start);
    }
    const end = body.search(/Amazon is an equal opportunity employer/i);
    if (end > 0) {
        body = body.substring(0, end);
    }
    details.description = body.trim();
}

  return details;
}


async function fetchAmazonSearchJobs(offset = 0, limit = AMAZON_PAGE_SIZE, signal) {

    const params = new URLSearchParams();

    params.append("radius", "24km");

    [
        "normalized_country_code",
        "normalized_state_name",
        "normalized_city_name",
        "location",
        "business_category",
        "category",
        "schedule_type_id",
        "employee_class",
        "normalized_location",
        "job_function_id",
        "is_manager",
        "is_intern"
    ].forEach(f => params.append("facets[]", f));

    params.append("offset", offset);
    params.append("result_limit", limit);

    params.append("sort", "relevant");

    params.append("latitude", "");
    params.append("longitude", "");
    params.append("loc_group_id", "");

    params.append("loc_query", "India");
    params.append("base_query", "Software");

    params.append("city", "");
    params.append("country", "");
    params.append("region", "");
    params.append("county", "");
    params.append("query_options", "");

    const url =
        "https://www.amazon.jobs/en/search.json?" +
        params.toString();

    logger.info(`Downloading Amazon jobs : offset=${offset}`);

    const response = await axios.get(url, {
        timeout: 60000,
          signal,
        headers: {
            Accept: "application/json"
        }
    });

    return response.data;
}

async function fetchAmazonSearchJobsWithRetries(offset = 0, limit = AMAZON_PAGE_SIZE, signal) {
  let retryCount = 0;

    for (let attempt = 1; attempt <= RETRY_MAX; attempt += 1) {
        try {
          if (signal?.aborted) throw stopError();
          const data = await fetchAmazonSearchJobs(offset, limit, signal);
      return { data, error: null, retryCount };
        } catch (err) {
            const status = err?.response?.status;
      const retryAfterMs = parseRetryAfter(err?.response?.headers?.['retry-after']);
            
            if (status === 404) {
                logger.info(`Amazon API returned 404 at offset ${offset}. Ending pagination.`);
        return { data: null, error: { code: 404, message: 'Not Found', isEndOfPagination: true }, retryCount };
            }
            
            if (signal?.aborted) {
        return { data: null, error: { message: 'Amazon scraper timed out', isStopped: true }, retryCount };
      }

            if (attempt >= RETRY_MAX) {
                logger.warn(`Amazon scrape failed after ${RETRY_MAX} retries at offset ${offset}: ${err.message}`);
        return { data: null, error: err, retryCount };
            }

      retryCount += 1;
      const backoffMs = RETRY_BACKOFF_MS[attempt - 1] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      const waitMs = retryAfterMs != null ? retryAfterMs : backoffMs;
            
      logger.warn(
        `Amazon request failed.\nAttempt: ${attempt}/${RETRY_MAX}\nOffset: ${offset}\nRetrying in ${waitMs} ms...\nError: ${err.message}`
      );
      await abortableDelay(waitMs, signal);
        }
    }
    
  return { data: null, error: new Error('Amazon fetch retry limit exceeded'), retryCount };
}

async function fetchAllSearchJobs(context) {

    logger.info("Downloading Amazon search results...");

    const allJobs = [];
    const seen = new Set();
    let offset = 0;
    let pageCount = 0;
    let totalCount = -1;
    let retryCount = 0;
    const limit = AMAZON_PAGE_SIZE;

    while (pageCount < context.maxPages && allJobs.length < context.maxJobs) {
      const { data: response, error, retryCount: pageRetryCount = 0 } = await fetchAmazonSearchJobsWithRetries(offset, limit, context.signal);
      retryCount += pageRetryCount;
        
        if (error?.isEndOfPagination) {
            logger.info(`Pagination ended: 404 received at offset ${offset}`);
            break;
        }
        
        if (error) {
          if (error.isStopped && !context.stopReason) context.stopReason = 'timed out';
            logger.warn(`Stopping pagination after error: ${error.message}`);
            break;
        }

        const jobs = response?.jobs || [];
        pageCount += 1;
        
        if (pageCount === 1 && response?.hits) {
            totalCount = response.hits;
        }

        if (!jobs.length) {
            logger.info(`No jobs returned at offset ${offset}. Ending pagination.`);
            break;
        }

        const normalized = jobs.map(job => ({
            positionId: job.id,
            title: job.title,
            location: job.location,
            apply_url: job.job_path ? `https://www.amazon.jobs${job.job_path}` : job.url_next_step,
            source: SOURCE,
            description: job.description_short || job.description || null,
            posted_date: normalizePostedDate(job.posted_date),
            work_mode: "onsite",
            experience: null,
            salary: null,
            employment_type: job.job_schedule_type,
            skills: [],
            status: "open",
            is_active: true
        }));
          const recentJobs = filterJobsWithinRecentCutoff(normalized);

        // Dedup within page
          for (const job of recentJobs) {
          if (allJobs.length >= context.maxJobs) break;
            if (!seen.has(job.apply_url)) {
                seen.add(job.apply_url);
                allJobs.push(job);
            }
        }

        logger.info(`Downloaded page ${pageCount}: ${recentJobs.length}/${normalized.length} jobs within cutoff (total unique: ${allJobs.length})`);

        if (allJobs.length >= context.maxJobs && !context.stopReason) context.stopReason = 'max job limit';

        // Check if we got fewer jobs than requested, indicating end of results
        if (jobs.length < limit) {
            logger.info(`Page ${pageCount} returned fewer than ${limit} jobs. Ending pagination.`);
            break;
        }

        offset += limit;
        await abortableDelay(Math.floor(Math.random() * (PAGINATION_DELAY_MAX_MS - PAGINATION_DELAY_MIN_MS + 1)) + PAGINATION_DELAY_MIN_MS, context.signal);
    }

      if (!context.stopReason && pageCount >= context.maxPages) context.stopReason = 'max page limit';

    logger.info(`Finished Amazon search.`);
    logger.info(`Total pages: ${pageCount}`);
    logger.info(`Total unique jobs: ${allJobs.length}`);
    
    return {
        allJobs,
        pageCount,
      totalCount: totalCount > 0 ? totalCount : allJobs.length,
      retryCount
    };
}

async function enrichOnlyNewJobs(allJobs, signal) {
  const applyUrls = allJobs.map((j) => j.apply_url).filter(Boolean);
  const existing = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingUrls = new Set((existing.data || []).map((r) => r.apply_url));

  const newJobs = allJobs.filter((j) => !existingUrls.has(j.apply_url));
  logger.info(`New jobs to enrich: ${newJobs.length}`);

  if (!newJobs.length) return { enriched: [], success: 0, failed: 0, skipped: allJobs.length };

  const enriched = [];
  let success = 0;
  let failed = 0;
  let fetched = 0;

  for (let index = 0; index < newJobs.length; index += DETAIL_CONCURRENCY) {
    const chunk = newJobs.slice(index, index + DETAIL_CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(async (job) => {
        if (signal?.aborted) throw stopError();
        await abortableDelay(
          Math.floor(Math.random() * (DETAIL_DELAY_MAX_MS - DETAIL_DELAY_MIN_MS + 1)) + DETAIL_DELAY_MIN_MS,
          signal
        );

        const jobController = new AbortController();
        const jobSignal = mergeAbortSignals(signal, jobController.signal);
        const timer = setTimeout(() => jobController.abort(), DETAIL_TIMEOUT_MS);

        try {
          const details = await normalizeDetails(job, job.apply_url, jobSignal);
          fetched += 1;
          logger.info(`Downloaded details ${fetched}/${newJobs.length}`);
          success += 1;
          return {
            ...job,
            description: details.description || job.description,
            apply_url: details.publicUrl || job.apply_url,
            employment_type: details.employment_type || job.employment_type,
            experience: details.experience || job.experience,
            salary: details.salary || job.salary,
            skills: details.skills.length ? details.skills : job.skills,
          };
        } catch (error) {
          failed += 1;
          logger.warn(`Amazon detail page failed for ${job.apply_url}: ${error.message}`);
          return job;
        } finally {
          clearTimeout(timer);
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        enriched.push(result.value);
      } else {
        failed += 1;
        logger.warn(`Amazon detail fetch rejected: ${result.reason?.message || result.reason}`);
      }
    }
  }

  return { enriched, success, failed, skipped: allJobs.length - newJobs.length };
}

async function scrapeAmazonJobs(query = '', location = '', fullSync = false, options = {}) {
  const startedAt = Date.now();
  const context = createScrapeContext(options?.signal || null);
  let allJobs = [];
  let pageCount = 0;
  let totalCount = 0;
  let retryCount = 0;
  try {
    const fetched = await fetchAllSearchJobs(context);
    allJobs = filterJobsWithinRecentCutoff(fetched.allJobs);
    ({ pageCount, totalCount, retryCount } = fetched);

  const applyUrls = allJobs.map((j) => j.apply_url).filter(Boolean);

  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingRows = existingResp.data || [];

  const allSourceResp = await getAllJobsBySource(SOURCE);
  const allSourceRows = allSourceResp.data || [];

  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(allJobs, existingRows, allSourceRows);

  logger.info(`Found ${newJobs.length} new, ${existingMatches.length} existing, ${removedRows.length} removed (source total ${allSourceRows.length})`);

  let enrichmentSummary = { enriched: [], success: 0, failed: 0, skipped: 0 };
  let saveStats = { inserted: 0, skippedDuplicates: 0, failed: 0 };
  try {
    enrichmentSummary = await enrichOnlyNewJobs(newJobs, context.signal);
    if (enrichmentSummary.enriched.length) {

    // Remote jobs india code
    // const jobsToSave = enrichmentSummary.enriched.filter(job => shouldSaveJob(job));
    // logger.info(`Jobs after India/Remote filter: ${jobsToSave.length}`);
    // const saveResult = await saveJobs(jobsToSave);

    const saveResult = await saveJobs(enrichmentSummary.enriched);
    saveStats = {
      inserted: saveResult?.stats?.inserted || 0,
      skippedDuplicates: saveResult?.stats?.skippedDuplicates || 0,
      failed: saveResult?.stats?.failed || 0,
    };
    logger.info(`Jobs inserted: ${saveStats.inserted}`);
    }
  } catch (err) {
    if (context.stopReason === 'timed out' || err.name === 'ScraperStoppedError') {
      if (!context.stopReason) context.stopReason = 'timed out';
      logger.warn(`Amazon scraper stopped: ${context.stopReason}`);
    }
    logger.error(`Enrichment failed: ${err.message}`);
  }

  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  const enrichedMap = new Map((enrichmentSummary.enriched || []).map((j) => [j.apply_url, j]));
  const result = allJobs.map((j) => enrichedMap.get(j.apply_url) || j);
  const filteredResult = result.filter((job) => shouldSaveJob(job));
  const durationMs = Date.now() - startedAt;
  const skippedJobs = enrichmentSummary.skipped + saveStats.skippedDuplicates;

  // Print metrics summary
  logger.info(
    `========================================\n` +
    `Amazon Scraper Summary\n` +
    `Pages Crawled : ${pageCount}\n` +
    `Jobs Fetched : ${allJobs.length}\n` +
    `New Jobs : ${newJobs.length}\n` +
    `Updated Jobs : ${updates.length}\n` +
    `Inserted Jobs : ${saveStats.inserted}\n` +
    `Skipped Jobs : ${skippedJobs}\n` +
    `Removed Jobs : ${removedApplyUrls.length}\n` +
    `Enriched Jobs : ${enrichmentSummary.enriched.length}\n` +
    `Retry Count : ${retryCount}\n` +
    `Duration : ${durationMs} ms\n` +
    `Stop Reason : ${context.stopReason || 'completed normally'}\n` +
    `========================================`
  );

  const stats = {
    pageCount,
    listingJobsFetched: allJobs.length,
    detailJobsFetched: enrichmentSummary.enriched.length,
    recentJobs: allJobs.length,
    skippedOld: Math.max(0, fetched.allJobs ? fetched.allJobs.length - allJobs.length : 0),
    stopReason: context.stopReason || 'completed normally',
    totalCount,
    totalFound: allJobs.length,
    newCount: newJobs.length,
    updatedCount: updates.length,
    removedCount: removedApplyUrls.length,
    resultCount: filteredResult.length,
  };

  return {
    result: filteredResult,
    stats,
  };
  } finally {
    clearTimeout(context.timeout);
  }
}

module.exports = { scrapeAmazonJobs };
