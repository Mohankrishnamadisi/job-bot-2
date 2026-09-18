#!/usr/bin/env node

require('dotenv').config({ path: '.env' });

const logger = require('../src/utils/logger');
const { runScrapers } = require('../src/scrapers');
const { deduplicateJobs } = require('../src/services/duplicateService');
const { saveJobs } = require('../src/database/jobRepository');
const { runAiWorker } = require('../src/workers/aiWorker');
const { filterRecentJobs } = require('../src/utils/jobDateFilter');
const { defaultRetentionDays } = require('../src/config/env');
const supabase = require('../src/database/supabaseClient');

const COMPANIES = ['microsoft', 'amazon', 'wipro', 'cognizant', 'capgemini'];

async function testCompanyScraper(companyName) {
  logger.info('');
  logger.info('═'.repeat(80));
  logger.info(`TESTING SCRAPER: ${companyName.toUpperCase()}`);
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
    errors: [],
  };

  try {
    // STAGE 1: Run scraper
    logger.info(`\n[STAGE 1] Running scraper for ${companyName}...`);
    const scrapedJobs = await runScrapers([companyName]);
    results.rawFetchedFromSource = scrapedJobs.length;
    logger.info(`  Raw fetched from source: ${results.rawFetchedFromSource} jobs`);

    if (results.rawFetchedFromSource === 0) {
      logger.warn(`  ⚠ No jobs returned from scraper - checking if it's a scraper failure or legitimate 0 jobs`);
      results.errors.push('Scraper returned 0 jobs - possible source unavailable or selector failure');
    }

    // STAGE 2: Check job structure validity
    logger.info(`\n[STAGE 2] Validating job structure...`);
    const validJobs = [];
    const invalidJobs = [];

    for (const job of scrapedJobs) {
      const hasRequiredFields = job && typeof job === 'object' && job.title && job.apply_url;
      if (hasRequiredFields) {
        validJobs.push(job);
      } else {
        invalidJobs.push(job);
      }
    }

    results.validExtractedJobs = validJobs.length;
    results.invalidFiltered = invalidJobs.length;
    logger.info(`  Valid extracted jobs: ${results.validExtractedJobs}`);
    if (results.invalidFiltered > 0) {
      logger.info(`  Invalid/filtered: ${results.invalidFiltered}`);
      results.errors.push(`Invalid job structure: ${results.invalidFiltered} jobs missing title or apply_url`);
    }

    // STAGE 3: Duplicate detection (database level)
    logger.info(`\n[STAGE 3] Running duplicate detection against database...`);
    const { uniqueJobs, duplicateCount } = await deduplicateJobs(validJobs);
    results.databaseDuplicates = duplicateCount;
    logger.info(`  Database duplicates found: ${results.databaseDuplicates}`);
    logger.info(`  Unique jobs to process: ${uniqueJobs.length}`);

    if (uniqueJobs.length === 0) {
      logger.warn(`  ⚠ All jobs marked as duplicates - possible incorrect duplicate detection`);
      results.errors.push(`All jobs marked as duplicates - possible duplicate detection bug`);
    }

    results.newJobsSentToSaveJobs = uniqueJobs.length;

    // STAGE 4: Save jobs to raw_jobs
    logger.info(`\n[STAGE 4] Saving jobs to raw_jobs table...`);
    const saveResult = await saveJobs(uniqueJobs);

    if (saveResult.error) {
      logger.error(`  ✗ Save failed: ${saveResult.error.message}`);
      results.errors.push(`Save failed: ${saveResult.error.message}`);
      return results;
    }

    const stats = saveResult.stats || {};
    results.insertedIntoRawJobs = stats.inserted || 0;
    results.updatedExisting = stats.updated || 0;

    logger.info(`  Prepared: ${stats.prepared || 0}`);
    logger.info(`  Inserted: ${results.insertedIntoRawJobs}`);
    logger.info(`  Updated: ${results.updatedExisting}`);
    logger.info(`  Skipped (already processed): ${stats.skippedDuplicates || 0}`);

    if (results.insertedIntoRawJobs === 0 && results.updatedExisting === 0) {
      logger.warn(`  ⚠ No jobs inserted or updated - checking ai_queue creation...`);
    }

    // STAGE 5: Check ai_queue entries created
    logger.info(`\n[STAGE 5] Checking ai_queue entries...`);
    const rawJobIds = saveResult.data && Array.isArray(saveResult.data)
      ? saveResult.data.map(row => row && row.id).filter(Boolean)
      : [];

    results.aiQueueCreated = rawJobIds.length;
    logger.info(`  Raw job IDs from save: ${rawJobIds.length}`);

    if (rawJobIds.length > 0) {
      // STAGE 6: Run AI Worker
      logger.info(`\n[STAGE 6] Running AI Worker on ${rawJobIds.length} job(s)...`);
      const aiResult = await runAiWorker({ 
        logger, 
        batchSize: Math.max(10, rawJobIds.length),
        rawJobIds 
      });

      results.aiCompleted = aiResult.jobsCompleted || 0;
      results.aiFailed = aiResult.jobsFailed || 0;

      logger.info(`  AI Worker loaded: ${aiResult.jobsLoaded || 0}`);
      logger.info(`  AI completed: ${results.aiCompleted}`);
      logger.info(`  AI failed: ${results.aiFailed}`);
    } else {
      logger.info(`  ⊘ No raw jobs to queue for AI`);
    }
  } catch (error) {
    logger.error(`\n✗ Test failed: ${error.message}`);
    logger.error(`  Stack: ${error.stack}`);
    results.errors.push(`Unhandled error: ${error.message}`);
  }

  // FINAL SUMMARY FOR THIS COMPANY
  logger.info(`\n${'─'.repeat(80)}`);
  logger.info(`SUMMARY: ${companyName.toUpperCase()}`);
  logger.info(`${'─'.repeat(80)}`);
  logger.info(`Raw fetched from source:    ${results.rawFetchedFromSource}`);
  logger.info(`Valid extracted jobs:       ${results.validExtractedJobs}`);
  logger.info(`Invalid/filtered:           ${results.invalidFiltered}`);
  logger.info(`Database duplicates:        ${results.databaseDuplicates}`);
  logger.info(`New jobs to saveJobs:       ${results.newJobsSentToSaveJobs}`);
  logger.info(`Inserted into raw_jobs:     ${results.insertedIntoRawJobs}`);
  logger.info(`Updated existing:           ${results.updatedExisting}`);
  logger.info(`AI queue created:           ${results.aiQueueCreated}`);
  logger.info(`AI completed:               ${results.aiCompleted}`);
  logger.info(`AI failed:                  ${results.aiFailed}`);

  if (results.errors.length > 0) {
    logger.info(`\nISSUES DETECTED:`);
    results.errors.forEach((err, idx) => {
      logger.error(`  ${idx + 1}. ${err}`);
    });
  } else if (results.insertedIntoRawJobs === 0 && results.updatedExisting === 0) {
    logger.warn(`\n⚠ No jobs inserted - trace needed`);
  } else {
    logger.info(`\n✓ Company scraper working`);
  }

  return results;
}

async function runAllCompanyTests() {
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('REAL COMPANY SCRAPER DIAGNOSTIC TEST');
  logger.info('█'.repeat(80));
  logger.info(`Testing ${COMPANIES.length} registered companies with real scraping`);
  logger.info(`Start time: ${new Date().toISOString()}`);

  const allResults = [];

  for (const company of COMPANIES) {
    const result = await testCompanyScraper(company);
    allResults.push(result);
  }

  // OVERALL SUMMARY
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('OVERALL SUMMARY - ALL COMPANIES');
  logger.info('█'.repeat(80));
  logger.info('');
  logger.info('COMPANY            | Fetched | Valid | Dups | New | Inserted | Queued | AI Done | Issues');
  logger.info(''.padEnd(80, '─'));

  for (const result of allResults) {
    const issues = result.errors.length > 0 ? `YES (${result.errors.length})` : 'No';
    const line = `${result.company.padEnd(18)} | ${String(result.rawFetchedFromSource).padEnd(7)} | ${String(result.validExtractedJobs).padEnd(5)} | ${String(result.databaseDuplicates).padEnd(4)} | ${String(result.newJobsSentToSaveJobs).padEnd(3)} | ${String(result.insertedIntoRawJobs).padEnd(8)} | ${String(result.aiQueueCreated).padEnd(6)} | ${String(result.aiCompleted).padEnd(7)} | ${issues}`;
    logger.info(line);
  }

  // DIAGNOSIS SECTION
  logger.info('');
  logger.info('█'.repeat(80));
  logger.info('DIAGNOSIS - COMPANIES WITH 0 INSERTS');
  logger.info('█'.repeat(80));

  const failedCompanies = allResults.filter(r => r.insertedIntoRawJobs === 0 && r.updatedExisting === 0);

  if (failedCompanies.length === 0) {
    logger.info('✓ All companies successfully inserted jobs');
  } else {
    for (const result of failedCompanies) {
      logger.info(`\n${result.company.toUpperCase()}:`);

      if (result.rawFetchedFromSource === 0) {
        logger.error(`  → Scraper returned 0 jobs (check source availability, selectors, authentication)`);
      } else if (result.validExtractedJobs === 0) {
        logger.error(`  → Jobs extracted but invalid structure (missing title or apply_url)`);
      } else if (result.newJobsSentToSaveJobs === 0) {
        logger.error(`  → All jobs marked as duplicates at dedup stage`);
      } else {
        logger.error(`  → Jobs sent to saveJobs but not inserted (check database constraints)`);
      }

      if (result.errors.length > 0) {
        result.errors.forEach(err => logger.error(`    • ${err}`));
      }
    }
  }

  logger.info('');
  logger.info(`End time: ${new Date().toISOString()}`);
  logger.info('');

  return allResults;
}

runAllCompanyTests().then((results) => {
  const successCount = results.filter(r => r.insertedIntoRawJobs > 0 || r.updatedExisting > 0).length;
  logger.info(`✓ Test complete: ${successCount}/${results.length} companies working`);
  process.exit(failedCompanies.length > 0 ? 1 : 0);
}).catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
