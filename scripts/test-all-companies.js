#!/usr/bin/env node

require('dotenv').config({ path: '.env' });

const logger = require('../src/utils/logger');
const { runScrapers } = require('../src/scrapers');
const { deduplicateJobs } = require('../src/services/duplicateService');
const { saveJobs } = require('../src/database/jobRepository');
const { runAiWorker } = require('../src/workers/aiWorker');

const COMPANIES = ['microsoft', 'amazon', 'wipro', 'cognizant', 'capgemini'];
const TIMEOUT_PER_COMPANY_MS = 120000;  // 2 minutes per company max

async function testCompanyScraper(companyName) {
  logger.info('');
  logger.info('═'.repeat(80));
  logger.info(`COMPANY: ${companyName.toUpperCase()}`);
  logger.info('═'.repeat(80));

  const results = {
    company: companyName,
    rawFetchedFromSource: 0,
    validExtractedJobs: 0,
    invalidFiltered: 0,
    databaseDuplicates: 0,
    newJobsSentToSaveJobs: 0,
    insertedIntoRawJobs: 0,
    updatedExisting: 0,
    aiQueueCreated: 0,
    aiCompleted: 0,
    aiFailed: 0,
  };

  try {
    // STAGE 1: Run scraper with timeout
    logger.info(`Fetching jobs from ${companyName}...`);
    
    const scrapedJobs = await Promise.race([
      runScrapers([companyName]),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Scraper timeout after ${TIMEOUT_PER_COMPANY_MS}ms`)), TIMEOUT_PER_COMPANY_MS)
      )
    ]);

    results.rawFetchedFromSource = scrapedJobs.length;
    logger.info(`  Raw fetched: ${results.rawFetchedFromSource}`);

    if (results.rawFetchedFromSource === 0) {
      logger.warn(`  ⚠ Scraper returned 0 jobs`);
      return results;
    }

    // STAGE 2: Validate job structure
    const validJobs = scrapedJobs.filter(job => job && typeof job === 'object' && job.title && job.apply_url);
    const invalidJobs = scrapedJobs.filter(job => !(job && typeof job === 'object' && job.title && job.apply_url));

    results.validExtractedJobs = validJobs.length;
    results.invalidFiltered = invalidJobs.length;

    if (results.validExtractedJobs === 0) {
      logger.warn(`  ⚠ All ${results.invalidFiltered} jobs have invalid structure`);
      return results;
    }

    // STAGE 3: Duplicate detection
    const { uniqueJobs, duplicateCount } = await deduplicateJobs(validJobs);
    results.databaseDuplicates = duplicateCount;
    results.newJobsSentToSaveJobs = uniqueJobs.length;

    logger.info(`  Valid extracted: ${results.validExtractedJobs}`);
    logger.info(`  Database duplicates: ${results.databaseDuplicates}`);
    logger.info(`  New to process: ${results.newJobsSentToSaveJobs}`);

    if (results.newJobsSentToSaveJobs === 0) {
      logger.info(`  ⊘ All jobs are duplicates, nothing new to save`);
      return results;
    }

    // STAGE 4: Save to raw_jobs
    const saveResult = await saveJobs(uniqueJobs);

    if (saveResult.error) {
      logger.error(`  ✗ Save failed: ${saveResult.error.message}`);
      return results;
    }

    const stats = saveResult.stats || {};
    results.insertedIntoRawJobs = stats.inserted || 0;
    results.updatedExisting = stats.updated || 0;

    logger.info(`  Inserted: ${results.insertedIntoRawJobs}`);
    logger.info(`  Updated: ${results.updatedExisting}`);

    // STAGE 5: Check AI queue
    const rawJobIds = saveResult.data && Array.isArray(saveResult.data)
      ? saveResult.data.map(row => row && row.id).filter(Boolean)
      : [];

    results.aiQueueCreated = rawJobIds.length;

    if (rawJobIds.length > 0) {
      logger.info(`  AI queue created: ${results.aiQueueCreated}`);
      
      // STAGE 6: Run AI Worker (limited)
      const aiResult = await runAiWorker({
        logger,
        batchSize: Math.min(10, rawJobIds.length),
        rawJobIds
      });

      results.aiCompleted = aiResult.jobsCompleted || 0;
      results.aiFailed = aiResult.jobsFailed || 0;

      logger.info(`  AI completed: ${results.aiCompleted}`);
      logger.info(`  AI failed: ${results.aiFailed}`);
    }

  } catch (error) {
    logger.error(`  ✗ Error: ${error.message}`);
  }

  return results;
}

async function runAllTests() {
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('REAL COMPANY SCRAPER TEST - ALL 5 COMPANIES');
  logger.info('█'.repeat(80));
  logger.info(`Start: ${new Date().toISOString()}`);

  const allResults = [];

  for (const company of COMPANIES) {
    const result = await testCompanyScraper(company);
    allResults.push(result);
  }

  // SUMMARY TABLE
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('SUMMARY TABLE');
  logger.info('█'.repeat(80));
  logger.info('');
  logger.info('COMPANY        | Fetched | Valid | Dups | New | Inserted | Updated | Queued | AI Done');
  logger.info(''.padEnd(80, '─'));

  for (const result of allResults) {
    const line = `${result.company.padEnd(14)} | ${String(result.rawFetchedFromSource).padEnd(7)} | ${String(result.validExtractedJobs).padEnd(5)} | ${String(result.databaseDuplicates).padEnd(4)} | ${String(result.newJobsSentToSaveJobs).padEnd(3)} | ${String(result.insertedIntoRawJobs).padEnd(8)} | ${String(result.updatedExisting).padEnd(7)} | ${String(result.aiQueueCreated).padEnd(6)} | ${result.aiCompleted}`;
    logger.info(line);
  }

  // RESULTS
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('RESULTS');
  logger.info('█'.repeat(80));

  const totalFetched = allResults.reduce((sum, r) => sum + r.rawFetchedFromSource, 0);
  const totalInserted = allResults.reduce((sum, r) => sum + r.insertedIntoRawJobs, 0);
  const totalQueued = allResults.reduce((sum, r) => sum + r.aiQueueCreated, 0);
  const totalAiCompleted = allResults.reduce((sum, r) => sum + r.aiCompleted, 0);

  logger.info(`\nTotal jobs fetched: ${totalFetched}`);
  logger.info(`Total jobs inserted: ${totalInserted}`);
  logger.info(`Total AI queue entries: ${totalQueued}`);
  logger.info(`Total AI completed: ${totalAiCompleted}`);

  // Working companies
  const working = allResults.filter(r => r.insertedIntoRawJobs > 0 || r.updatedExisting > 0);
  logger.info(`\nWorking companies: ${working.length}/${COMPANIES.length}`);
  working.forEach(r => {
    logger.info(`  ✓ ${r.company}: ${r.insertedIntoRawJobs + r.updatedExisting} jobs`);
  });

  // Failed companies
  const failed = allResults.filter(r => r.insertedIntoRawJobs === 0 && r.updatedExisting === 0 && r.rawFetchedFromSource > 0);
  if (failed.length > 0) {
    logger.info(`\nFailed companies (fetched but 0 inserted):`);
    failed.forEach(r => {
      if (r.rawFetchedFromSource === 0) {
        logger.error(`  ✗ ${r.company}: Scraper returned 0 jobs`);
      } else if (r.validExtractedJobs === 0) {
        logger.error(`  ✗ ${r.company}: Invalid job structure (${r.invalidFiltered} jobs)`);
      } else if (r.newJobsSentToSaveJobs === 0) {
        logger.error(`  ✗ ${r.company}: All jobs are duplicates (database)`);
      } else {
        logger.error(`  ✗ ${r.company}: Save/insert failed`);
      }
    });
  }

  logger.info('');
  logger.info(`End: ${new Date().toISOString()}`);

  process.exit(failed.length > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  logger.error(`Fatal: ${error.message}`);
  process.exit(1);
});
