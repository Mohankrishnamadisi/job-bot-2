#!/usr/bin/env node

require('dotenv').config({ path: '.env' });

const logger = require('../src/utils/logger');
const { runScrapers } = require('../src/scrapers');
const supabase = require('../src/database/supabaseClient');

async function traceMicrosoftIssue() {
  logger.info('');
  logger.info('═'.repeat(80));
  logger.info('TRACING MICROSOFT SCRAPER ISSUE');
  logger.info('═'.repeat(80));

  try {
    // Step 1: Run Microsoft scraper
    logger.info('\n[STEP 1] Running Microsoft scraper...');
    const scrapedJobs = await runScrapers(['microsoft']);
    logger.info(`  Scraped ${scrapedJobs.length} jobs from Microsoft careers`);

    if (scrapedJobs.length === 0) {
      logger.error('  No jobs returned from scraper');
      process.exit(1);
    }

    // Step 2: Extract apply_urls
    logger.info('\n[STEP 2] Analyzing apply_urls...');
    const applyUrls = scrapedJobs
      .map(j => j.apply_url)
      .filter(url => typeof url === 'string' && url.trim() !== '');

    logger.info(`  Found ${applyUrls.length} apply_urls`);
    applyUrls.forEach((url, idx) => {
      logger.info(`    ${idx + 1}. ${url.substring(0, 80)}...`);
    });

    // Step 3: Check processed_job_keys table
    logger.info('\n[STEP 3] Checking processed_job_keys table...');
    if (applyUrls.length > 0) {
      const { data: processedKeys, error: processedError } = await supabase
        .from('processed_job_keys')
        .select('apply_url, created_at')
        .in('apply_url', applyUrls);

      if (processedError) {
        logger.error(`  Error: ${processedError.message}`);
      } else {
        logger.info(`  Found ${processedKeys.length} in processed_job_keys table`);
        processedKeys.forEach((row, idx) => {
          logger.info(`    ${idx + 1}. ${row.apply_url.substring(0, 70)}... (created: ${row.created_at})`);
        });
      }
    }

    // Step 4: Check raw_jobs table
    logger.info('\n[STEP 4] Checking raw_jobs table...');
    if (applyUrls.length > 0) {
      const { data: rawJobs, error: rawError } = await supabase
        .from('raw_jobs')
        .select('id, apply_url, title, ai_processed, created_at')
        .in('apply_url', applyUrls);

      if (rawError) {
        logger.error(`  Error: ${rawError.message}`);
      } else {
        logger.info(`  Found ${rawJobs.length} in raw_jobs table`);
        rawJobs.forEach((row, idx) => {
          logger.info(`    ${idx + 1}. ${row.title}`);
          logger.info(`       URL: ${row.apply_url.substring(0, 70)}...`);
          logger.info(`       AI Processed: ${row.ai_processed}, Created: ${row.created_at}`);
        });
      }
    }

    // Step 5: Check processed_jobs table
    logger.info('\n[STEP 5] Checking processed_jobs table...');
    if (applyUrls.length > 0) {
      const { data: processedJobs, error: procError } = await supabase
        .from('processed_jobs')
        .select('id, title, apply_url, created_at')
        .in('apply_url', applyUrls);

      if (procError) {
        logger.error(`  Error: ${procError.message}`);
      } else {
        logger.info(`  Found ${processedJobs.length} in processed_jobs table`);
        processedJobs.forEach((row, idx) => {
          logger.info(`    ${idx + 1}. ${row.title}`);
          logger.info(`       URL: ${row.apply_url.substring(0, 70)}...`);
          logger.info(`       Created: ${row.created_at}`);
        });
      }
    }

    // SUMMARY & DIAGNOSIS
    logger.info('\n' + '═'.repeat(80));
    logger.info('DIAGNOSIS');
    logger.info('═'.repeat(80));

    if (applyUrls.length > 0) {
      const { data: processedKeys } = await supabase
        .from('processed_job_keys')
        .select('apply_url')
        .in('apply_url', applyUrls);

      const foundInProcessedKeys = (processedKeys || []).length;
      const { data: rawJobs } = await supabase
        .from('raw_jobs')
        .select('apply_url')
        .in('apply_url', applyUrls);

      const foundInRawJobs = (rawJobs || []).length;
      const { data: processedJobs } = await supabase
        .from('processed_jobs')
        .select('apply_url')
        .in('apply_url', applyUrls);

      const foundInProcessedJobs = (processedJobs || []).length;

      logger.info(`\nApply URLs Status:`);
      logger.info(`  Scraped: ${applyUrls.length}`);
      logger.info(`  In processed_job_keys: ${foundInProcessedKeys}`);
      logger.info(`  In raw_jobs: ${foundInRawJobs}`);
      logger.info(`  In processed_jobs: ${foundInProcessedJobs}`);

      if (foundInProcessedKeys > 0) {
        logger.error(`\n✗ PROBLEM FOUND:`);
        logger.error(`  ${foundInProcessedKeys} of ${applyUrls.length} scraped jobs are marked as already processed`);
        logger.error(`  These are fresh jobs from the scraper, they should NOT be in processed_job_keys`);
        logger.error(`\n  LIKELY CAUSES:`);
        logger.error(`  1. Jobs were previously enriched and entries weren't cleaned up`);
        logger.error(`  2. processed_job_keys table has stale entries`);
        logger.error(`  3. apply_url matching issue (same job with different URLs)`);
      } else if (foundInRawJobs > 0) {
        logger.warn(`\n⚠ SECONDARY ISSUE:`);
        logger.warn(`  ${foundInRawJobs} jobs exist in raw_jobs but not in processed_job_keys`);
        logger.warn(`  This is expected for newly scraped jobs`);
      } else {
        logger.info(`\n✓ All jobs are fresh (not in any table)`);
      }
    }

    process.exit(0);
  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

traceMicrosoftIssue();
