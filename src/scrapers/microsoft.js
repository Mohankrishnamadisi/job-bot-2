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

const {
  findJobsForSync,
  buildJobUpdates,
  saveNewJobs,
  updateExistingJobs,
  markRemovedJobs,
} = require('../parsers/common/jobSyncService');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SEARCH_ENDPOINT = 'https://apply.careers.microsoft.com/api/pcsx/search';
const DETAILS_ENDPOINT = 'https://apply.careers.microsoft.com/api/pcsx/position_details';
const DOMAIN = 'microsoft.com';
const DEFAULT_LIMIT = 20;
const MAX_SEARCH_PAGES = 2;
const SEARCH_RETRY_MAX = 5;
const SEARCH_RETRY_BASE_MS = 1000;
const SEARCH_DELAY_MIN_MS = 1000;
const SEARCH_DELAY_MAX_MS = 2000;
const DETAIL_CONCURRENCY = 2;
const DETAIL_DELAY_MIN_MS = 300;
const DETAIL_DELAY_MAX_MS = 500;
const DETAIL_RETRY_MAX = 3;
const DETAIL_RETRY_BASE_MS = 3000;
const SOURCE = 'Microsoft';

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) return Math.max(timestamp - Date.now(), 0);
  return null;
}

async function scrapeJobDetailPage(applyUrl) {
  if (!applyUrl) return { bodyText: null, ldJsonScripts: [], topSkills: [] };

  let page;
  try {
    page = await newPage();
    await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 60000 });

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
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function normalizeDetails(data, applyUrl) {
  if (!data || typeof data !== 'object') return {};

  const description = data.jobDescription || data.job_description || data.description || null;
  const publicUrl = data.publicUrl || data.public_url || null;
  const apiEmploymentType = data.employmentType || data.employment_type || null;
  const details = {
    description,
    publicUrl,
    employment_type: parseEmploymentType(apiEmploymentType),
    experience: extractExperience(description || ''),
    salary: extractSalary(description || ''),
    skills: [],
    work_mode: null,
  };

  const pageDetails = await scrapeJobDetailPage(applyUrl);

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
    `${description || ""}\n${pageDetails.bodyText || ""}`
);

  return details;
}

function normalizeJob(position) {
  const positionId = position.position_id || position.id || null;
  const title = position.title || position.name || null;
  const location = Array.isArray(position.locations) ? position.locations[0] : position.location || null;
  const workType = position.work_type || position.workLocationOption || null;
  
  // Convert Unix epoch timestamp to ISO string if needed
  const rawPostedTs = position.posted_date || position.postedTs || null;
  const parsedPostedDate = rawPostedTs == null ? null : new Date(typeof rawPostedTs === 'number' ? rawPostedTs * 1000 : rawPostedTs);
  const postedDate = parsedPostedDate && !Number.isNaN(parsedPostedDate.getTime())
    ? parsedPostedDate.toISOString()
    : null;
  
  const positionUrl = position.positionUrl || position.position_url || position.offsetUrl || null;
  const applyUrl = positionUrl ? `https://apply.careers.microsoft.com${positionUrl}` : null;

  return {
    positionId,
    title,
    source: SOURCE,
    location,
    work_mode: workType,
    posted_date: postedDate,
    description: null,
    apply_url: applyUrl,
    status: 'open',
    is_active: true,
  };
}
function extractPositions(responseData) {
  if (!responseData || typeof responseData !== 'object') return [];
  const positions = responseData.data?.positions || responseData.positions || [];
  return Array.isArray(positions) ? positions : [];
}

async function fetchSearchPage(start, limit, query = '', location = '') {
  const response = await axios.get(SEARCH_ENDPOINT, {
    params: { domain: DOMAIN, query, location, start, limit },
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
    timeout: 60000,
  });
  return response.data;
}

async function fetchSearchPageWithRetries(start, limit, query = '', location = '') {
  for (let attempt = 1; attempt <= SEARCH_RETRY_MAX; attempt += 1) {
    try {
      const data = await fetchSearchPage(start, limit, query, location);
      return { data, error: null };
    } catch (err) {
      const status = err?.response?.status;
      const retryAfterMs = parseRetryAfter(err?.response?.headers?.['retry-after']);

      if (status === 429) {
        const waitMs = retryAfterMs != null ? retryAfterMs : SEARCH_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(`Waiting ${Math.round(waitMs / 1000)} seconds due to rate limit...`);
        await delay(waitMs);
        logger.info('Retrying page...');
        if (attempt >= SEARCH_RETRY_MAX) {
          return { data: null, error: err };
        }
        continue;
      }

      return { data: null, error: err };
    }
  }

  return { data: null, error: new Error('Search page retry limit exceeded') };
}

async function fetchPositionDetailsWithRetries(positionId) {
  if (!positionId) return { error: 'no-id' };

  for (let attempt = 1; attempt <= DETAIL_RETRY_MAX; attempt += 1) {
    try {
      const res = await axios.get(DETAILS_ENDPOINT, {
        params: { position_id: positionId, domain: DOMAIN, hl: 'en' },
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
        timeout: 60000,
      });

      return { data: res.data, error: null };
    } catch (err) {
      const status = err?.response?.status;

      if (status === 403) {
        return { data: null, error: { code: 403, message: 'Forbidden' } };
      }

      if (status === 429) {
        const retryAfterMs = parseRetryAfter(err.response?.headers?.['retry-after']);
        const backoff = retryAfterMs != null ? retryAfterMs : DETAIL_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        if (attempt >= DETAIL_RETRY_MAX) {
          return { data: null, error: { code: 429, message: 'Too Many Requests' } };
        }
        await delay(backoff);
        continue;
      }

      return { data: null, error: { code: status || 0, message: err.message || 'unknown' } };
    }
  }

  return { data: null, error: { code: 0, message: 'max retries reached' } };
}

async function fetchAllSearchJobs(query = '', location = '', fullSync = false) {
  const allJobs = [];
  const seen = new Set();
  let start = 0;
  let page = 1;
  let pageSize = 0;
  let totalCount = -1;
  const pageLimit = fullSync ? Number.MAX_SAFE_INTEGER : MAX_SEARCH_PAGES;
  const pageLimitLabel = fullSync ? 'full' : MAX_SEARCH_PAGES;

  while (page <= pageLimit) {
    const { data, error } = await fetchSearchPageWithRetries(start, DEFAULT_LIMIT, query, location);
    if (error) {
      logger.warn(`Skipping page ${page} after repeated search failures.`);
      break;
    }

    const positions = extractPositions(data);
    if (page === 1) {
      totalCount = Number(data.data?.count ?? data.count ?? -1);
      pageSize = positions.length;
    }

    if (!positions.length) {
      logger.info(`No jobs found on page ${page}. Ending search.`);
      break;
    }

    const jobs = positions.map(normalizeJob).filter((j) => j.positionId && j.title && j.apply_url);
    const recentJobs = filterJobsWithinRecentCutoff(jobs);
    recentJobs.forEach((j) => {
      if (!seen.has(j.apply_url)) {
        seen.add(j.apply_url);
        allJobs.push(j);
      }
    });

    logger.info(`Downloaded page ${page}/${pageLimitLabel}: ${recentJobs.length}/${jobs.length} jobs within cutoff`);

    if (pageSize === 0 || (totalCount > 0 && start + pageSize >= totalCount)) {
      break;
    }

    await delay(Math.floor(Math.random() * (SEARCH_DELAY_MAX_MS - SEARCH_DELAY_MIN_MS + 1)) + SEARCH_DELAY_MIN_MS);
    start += pageSize;
    page += 1;
  }

  logger.info('Finished search successfully.');
  logger.info(`Search pages: ${page - 1}`);
  logger.info(`Total search jobs: ${allJobs.length}`);
  return { allJobs, pageCount: page - 1, totalCount };
}

async function enrichOnlyNewJobs(allJobs) {
  const applyUrls = allJobs.map((j) => j.apply_url).filter(Boolean);
  const existing = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingUrls = new Set((existing.data || []).map((r) => r.apply_url));

  const newJobs = allJobs.filter((j) => !existingUrls.has(j.apply_url));
  logger.info(`New jobs to enrich: ${newJobs.length}`);

  if (!newJobs.length) return { enriched: [], success: 0, failed: 0, skipped: allJobs.length };

  const chunks = chunkArray(newJobs, DETAIL_CONCURRENCY);
  const enriched = [];
  let success = 0;
  let failed = 0;
  let fetched = 0;

  for (const chunk of chunks) {
    const promises = chunk.map(async (job) => {
      await delay(Math.floor(Math.random() * (DETAIL_DELAY_MAX_MS - DETAIL_DELAY_MIN_MS + 1)) + DETAIL_DELAY_MIN_MS);
      const { data, error } = await fetchPositionDetailsWithRetries(job.positionId);
      fetched += 1;
      logger.info(`Downloaded details ${fetched}/${newJobs.length}`);

      if (error) {
        failed += 1;
        return job;
      }

      const details = await normalizeDetails(data.data || data, job.apply_url);
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
    });

    const results = await Promise.all(promises);
    enriched.push(...results);
  }

  return { enriched, success, failed, skipped: allJobs.length - newJobs.length };
}

async function enrichAndUpdateJobsAsync(newJobs) {
  if (!newJobs || !newJobs.length) return;

  try {
    logger.info(`Starting async enrichment for ${newJobs.length} jobs`);

    const applyUrls = newJobs.map((j) => j.apply_url).filter(Boolean);
    const existing = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
    const existingUrls = new Set((existing.data || []).map((r) => r.apply_url));
    const jobsToEnrich = newJobs.filter((j) => !existingUrls.has(j.apply_url));

    if (!jobsToEnrich.length) {
      logger.info('All jobs already exist in DB; no enrichment needed');
      return;
    }

    const chunks = chunkArray(jobsToEnrich, DETAIL_CONCURRENCY);
    let success = 0;
    let failed = 0;
    let fetched = 0;

    for (const chunk of chunks) {
      const promises = chunk.map(async (job) => {
        await delay(Math.floor(Math.random() * (DETAIL_DELAY_MAX_MS - DETAIL_DELAY_MIN_MS + 1)) + DETAIL_DELAY_MIN_MS);
        const { data, error } = await fetchPositionDetailsWithRetries(job.positionId);
        fetched += 1;

        if (fetched % 50 === 0) {
          logger.info(`Async enrichment: ${fetched}/${jobsToEnrich.length} details fetched`);
        }

        if (error) {
          failed += 1;
          return null;
        }

        const details = await normalizeDetails(data.data || data, job.apply_url);
        success += 1;

        return {
          apply_url: job.apply_url,
          description: details.description || null,
          employment_type: details.employment_type || null,
          experience: details.experience || null,
          salary: details.salary || null,
          skills: details.skills.length ? details.skills : null,
        };
      });

      const results = await Promise.all(promises);
      const updates = results.filter(Boolean).map((update) => ({ ...update, id: null }));

      if (updates.length) {
        for (const update of updates) {
          const existingJob = existing.data.find((j) => j.apply_url === update.apply_url);
          if (existingJob) {
            update.id = existingJob.id;
          }
        }

        const validUpdates = updates.filter((u) => u.id);
        if (validUpdates.length) {
          await updateJobs(validUpdates);
          logger.info(`Async enrichment: updated ${validUpdates.length} jobs`);
        }
      }
    }

    logger.info(`Async enrichment complete: ${success} succeeded, ${failed} failed out of ${jobsToEnrich.length}`);
  } catch (err) {
    logger.error(`Async enrichment error: ${err.message}`);
  }
}

async function scrapeMicrosoftJobs(query = '', location = '', fullSync = false) {
  const { allJobs, pageCount, totalCount } = await fetchAllSearchJobs(query, location, fullSync);
  const recentJobs = filterJobsWithinRecentCutoff(allJobs);

  const applyUrls = recentJobs.map((j) => j.apply_url).filter(Boolean);

  const existingResp = await getJobsBySourceAndApplyUrls(SOURCE, applyUrls);
  const existingRows = existingResp.data || [];

  const allSourceResp = await getAllJobsBySource(SOURCE);
  const allSourceRows = allSourceResp.data || [];

  const { newJobs, existingMatches, removedRows, removedApplyUrls } = findJobsForSync(recentJobs, existingRows, allSourceRows);

  logger.info(`Found ${newJobs.length} new, ${existingMatches.length} existing, ${removedRows.length} removed (source total ${allSourceRows.length})`);

  let saveStats = { fetched: 0, prepared: 0, inserted: 0, skippedDuplicates: 0, failed: 0 };
  if (newJobs.length) {
    const saveResult = await saveJobs(newJobs);
    saveStats = saveResult.stats || {};
    logger.info(`New jobs saved immediately: ${saveStats.inserted}`);

    enrichAndUpdateJobsAsync(newJobs).catch((err) => {
      logger.error(`Background enrichment error: ${err.message}`);
    });
  }

  const updates = buildJobUpdates(existingMatches);
  await updateExistingJobs(updates, updateJobs, logger);
  await markRemovedJobs(removedRows, markJobsInactive, logger, SOURCE);

  logger.info(`Search pages: ${pageCount}`);
  logger.info(`Total jobs: ${allJobs.length}`);
  logger.info(`New jobs saved: ${saveStats.inserted}`);
  logger.info(`Enrichment started asynchronously (background process)`);

  return {
    result: newJobs,
    stats: { pageCount, totalCount, totalFound: allJobs.length, newCount: newJobs.length, updatedCount: updates.length, removedCount: removedApplyUrls.length },
  };
}

module.exports = { scrapeMicrosoftJobs };
