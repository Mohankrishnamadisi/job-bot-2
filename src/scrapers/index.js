const { scrapeCompanyJobs } = require('./companyScraper');
const { scrapeAmazonJobs } = require('./amazon');
const { scrapeCapgeminiJobs } = require('./capgemini');
const { scrapeCognizantJobs } = require('./cognizant');
const { scrapeMicrosoftJobs } = require('./microsoft');
const { scrapeWiproJobs } = require('./wipro');
const { scrapeIbmJobs } = require('./ibm');
const { importInfosysJobs } = require('../services/fetchInfosysJobs');
const { scrapeDeloitteJobs } = require('./deloitte');
const { scrapeCiscoJobs } = require('./cisco');
const { scrapeNttDataJobs } = require('./nttdata');
const { scrapeLtimindtreeJobs } = require('./ltimindtree');
const { scrapeMphasisJobs } = require('./mphasis');
const { scrapePersistentJobs } = require('./persistent');
const { scrapeGoogleJobs } = require('./google');
const logger = require('../utils/logger');
const { filterJobsWithinRecentCutoff } = require('../utils/recentJobPolicy');

const SCRAPER_REGISTRY = {
  amazon: scrapeAmazonJobs,
  capgemini: scrapeCapgeminiJobs,
  cognizant: scrapeCognizantJobs,
  deloitte: scrapeDeloitteJobs,
  cisco: scrapeCiscoJobs,
  nttdata: scrapeNttDataJobs,
  ltimindtree: scrapeLtimindtreeJobs,
  mphasis: scrapeMphasisJobs,
  persistent: scrapePersistentJobs,
  google: scrapeGoogleJobs,
  microsoft: () => scrapeMicrosoftJobs('', '', false),
  ibm: scrapeIbmJobs,
  infosys: async () => {
    const response = await importInfosysJobs();
    return {
      result: Array.isArray(response?.jobs) ? response.jobs : [],
      stats: {
        pageCount: 1,
        listingJobsFetched: response?.total_fetched || 0,
        recentJobs: response?.jobs?.length || 0,
        skippedOld: 0,
        stopReason: response?.total_failed ? 'error' : 'completed normally',
      },
    };
  },
  wipro: scrapeWiproJobs,
};

const DEFAULT_SCRAPER_ORDER = ['microsoft', 'ibm', 'amazon', 'wipro', 'cognizant', 'capgemini', 'infosys', 'deloitte', 'cisco', 'nttdata', 'ltimindtree', 'mphasis', 'persistent', 'google'];

function getRegisteredScraperKeys() {
  const registryKeys = Object.keys(SCRAPER_REGISTRY);
  const ordered = DEFAULT_SCRAPER_ORDER.filter((key) => registryKeys.includes(key));
  const extras = registryKeys.filter((key) => !ordered.includes(key));
  return [...ordered, ...extras];
}

async function runScrapers(urls = [], options = {}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    logger.warn('No scraper URLs provided');
    return [];
  }

  const { signal } = options;
  const results = [];

  for (const item of urls) {
    try {
      const key = String(item).trim().toLowerCase();
      const registeredScraper = SCRAPER_REGISTRY[key];

      if (registeredScraper) {
        logger.info(`Starting registered scraper for ${key}`);
        const response = await registeredScraper('', '', false, { signal });
        const jobs = Array.isArray(response?.result) ? response.result : [];
        const stats = response?.stats || {
          pageCount: 0,
          listingJobsFetched: jobs.length,
          detailJobsFetched: 0,
          recentJobs: jobs.length,
          skippedOld: 0,
          stopReason: signal?.aborted ? 'timeout' : 'completed',
        };
        logger.info(
          `Scraper finished for ${key}: pageCount=${stats.pageCount || 0}, listingJobsFetched=${stats.listingJobsFetched ?? jobs.length}, detailJobsFetched=${stats.detailJobsFetched ?? 0}, recentJobs=${stats.recentJobs ?? jobs.length}, skippedOld=${stats.skippedOld ?? 0}, stopReason=${stats.stopReason || 'completed'}`
        );
        results.push(...jobs);
        continue;
      }

      logger.info(`Starting scraper for ${item}`);
      const jobs = await scrapeCompanyJobs(item);
      const recentJobs = jobs.filter((job) => filterJobsWithinRecentCutoff([job], { includeUnknownDate: true }).length > 0);
      logger.info(`Scraper finished for ${item}: jobs=${jobs.length}, recent=${recentJobs.length}, skippedOld=${jobs.length - recentJobs.length}`);
      results.push(...recentJobs);
    } catch (error) {
      logger.error(`Scraper error for ${item}: ${error.message}`);
    }
  }

  return results;
}

module.exports = {
  runScrapers,
  getRegisteredScraperKeys,
};
