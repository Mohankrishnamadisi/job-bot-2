const logger = require('../utils/logger');
const { newPage } = require('./browser');

const DEFAULT_JOB_SELECTOR = '.job-card, .job-listing, .job-item, [data-qa="job"]';
const DEFAULT_LOAD_DELAY = 1200;
const MAX_SCROLL_ITERATIONS = 10;

async function waitForPageReady(page, timeout = 30000) {
  await page.waitForLoadState('domcontentloaded', { timeout });
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function autoScroll(page) {
  let previousHeight = 0;
  for (let i = 0; i < MAX_SCROLL_ITERATIONS; i += 1) {
    const currentHeight = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return document.body.scrollHeight;
    });

    if (currentHeight === previousHeight) {
      break;
    }

    previousHeight = currentHeight;
    await page.waitForTimeout(DEFAULT_LOAD_DELAY);
  }
}

function parseJobNode(node) {
  const title = node.querySelector('h1, h2, h3, .job-title, [data-qa="job-title"]')?.textContent?.trim();
  const company = node.querySelector('.company-name, .employer, [data-qa="company"]')?.textContent?.trim();
  const location = node.querySelector('.location, .job-location, [data-qa="location"]')?.textContent?.trim();
  const experience = node.querySelector('.experience, .job-experience, [data-qa="experience"]')?.textContent?.trim();
  const description = node.querySelector('.description, .job-description, .job-summary, [data-qa="description"]')?.textContent?.trim();
  const postedDate = node.querySelector('time, [data-posted-date], [data-qa="posted-date"]')?.getAttribute('datetime') || node.querySelector('time, [data-posted-date], [data-qa="posted-date"]')?.textContent?.trim();
  const applyAnchor = node.querySelector('a[href*="apply"], a.apply-button, a[data-qa="apply"]');

  return {
    title: title || null,
    company: company || null,
    location: location || null,
    experience: experience || null,
    description: description || null,
    postedDate: postedDate || null,
    applyUrl: applyAnchor ? applyAnchor.href : null,
  };
}

function normalizeJobs(jobs) {
  return jobs
    .map((job) => ({
      title: job.title || 'Unknown',
      company: job.company || 'Unknown',
      location: job.location || 'Remote',
      experience: job.experience || null,
      description: job.description || null,
      posted_date: job.postedDate || job.posted_date || null,
      applyUrl: job.applyUrl || null,
    }))
    .filter((job) => job.title && job.company);
}

async function scrapeCompanyJobs(url) {
  const page = await newPage();

  try {
    logger.info(`Scraping company jobs from: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await waitForPageReady(page, 45000);
    await autoScroll(page);
    await page.waitForTimeout(DEFAULT_LOAD_DELAY);

    const jobs = await page.$$eval(DEFAULT_JOB_SELECTOR, (nodes) =>
      nodes.map((node) => {
        const title = node.querySelector('h1, h2, h3, .job-title, [data-qa="job-title"]')?.textContent?.trim();
        const company = node.querySelector('.company-name, .employer, [data-qa="company"]')?.textContent?.trim();
        const location = node.querySelector('.location, .job-location, [data-qa="location"]')?.textContent?.trim();
        const experience = node.querySelector('.experience, .job-experience, [data-qa="experience"]')?.textContent?.trim();
        const description = node.querySelector('.description, .job-description, .job-summary, [data-qa="description"]')?.textContent?.trim();
        const postedDate = node.querySelector('time, [data-posted-date], [data-qa="posted-date"]')?.getAttribute('datetime') || node.querySelector('time, [data-posted-date], [data-qa="posted-date"]')?.textContent?.trim();
        const applyAnchor = node.querySelector('a[href*="apply"], a.apply-button, a[data-qa="apply"]');

        return {
          title: title || null,
          company: company || null,
          location: location || null,
          experience: experience || null,
          description: description || null,
          postedDate: postedDate || null,
          applyUrl: applyAnchor ? applyAnchor.href : null,
        };
      })
    );

    const normalized = normalizeJobs(jobs);
    logger.info(`Found ${normalized.length} jobs on company page`);
    return normalized;
  } catch (error) {
    logger.error(`scrapeCompanyJobs failed for ${url}: ${error.message}`);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  scrapeCompanyJobs,
};
