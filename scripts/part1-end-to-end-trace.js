#!/usr/bin/env node
'use strict';

/**
 * PART 1 END-TO-END JOB TRACE SCRIPT
 * 
 * This script traces one representative job through the complete pipeline:
 * 1. Scraper → return job
 * 2. Duplicate detection → check if new
 * 3. Database save → insert into raw_jobs
 * 4. Queue creation → add to ai_queue
 * 5. AI enrichment → call Groq
 * 6. Response parse → validate JSON
 * 7. Save enrichment → insert into processed_jobs
 * 8. Mark complete → update flags
 */

require('dotenv').config({ path: '.env' });

const supabase = require('../src/database/supabaseClient');
const logger = require('../src/utils/logger');
const { runScrapers } = require('../src/scrapers');
const { deduplicateJobs } = require('../src/services/duplicateService');
const { saveJobs } = require('../src/database/jobRepository');
const { runAiWorker } = require('../src/workers/aiWorker');

async function main() {
  try {
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('PART 1: END-TO-END JOB PIPELINE TRACE');
    logger.info('═══════════════════════════════════════════════════════════════════════════\n');

    // ======================== STEP 1: SCRAPE ========================
    logger.info('STEP 1: SCRAPE ONE COMPANY');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const scrapedJobs = await runScrapers(['microsoft']);
    logger.info(`✓ Microsoft scraper returned ${scrapedJobs.length} jobs`);
    
    if (scrapedJobs.length === 0) {
      logger.error('✗ No jobs scraped. Cannot continue test.');
      process.exit(1);
    }

    const testJob = scrapedJobs[0];
    logger.info(`✓ Selected first job for tracing:`);
    logger.info(`  Title: ${testJob.title}`);
    logger.info(`  Company: ${testJob.company}`);
    logger.info(`  Apply URL: ${testJob.applyUrl || testJob.apply_url}`);
    logger.info('');

    // ======================== STEP 2: DUPLICATE CHECK ========================
    logger.info('STEP 2: DUPLICATE DETECTION');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { uniqueJobs, duplicateCount } = await deduplicateJobs([testJob]);
    logger.info(`✓ Duplicate detection completed`);
    logger.info(`  Input: 1 job`);
    logger.info(`  Duplicates: ${duplicateCount}`);
    logger.info(`  New: ${uniqueJobs.length}`);

    if (uniqueJobs.length === 0) {
      logger.info('  → Job is duplicate, skipping to next...');
      logger.info('  (This is expected if we test multiple times with same job)');
      process.exit(0);
    }

    const jobToSave = uniqueJobs[0];
    logger.info('');

    // ======================== STEP 3: SAVE TO DATABASE ========================
    logger.info('STEP 3: SAVE JOB TO DATABASE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const saveResult = await saveJobs([jobToSave]);
    if (saveResult.error) {
      logger.error(`✗ Save failed: ${saveResult.error.message}`);
      process.exit(1);
    }

    const insertedRawJobIds = Array.isArray(saveResult.data)
      ? saveResult.data.map((row) => row && row.id).filter(Boolean)
      : [];

    logger.info(`✓ Job saved to raw_jobs`);
    logger.info(`  Stats: ${JSON.stringify(saveResult.stats || {})}`);
    logger.info(`  Inserted raw_job IDs: ${insertedRawJobIds.join(', ')}`);

    if (insertedRawJobIds.length === 0) {
      logger.error('✗ No raw_job IDs returned. Save may have failed.');
      process.exit(1);
    }

    const rawJobId = insertedRawJobIds[0];
    logger.info('');

    // ======================== STEP 4: CHECK AI QUEUE ========================
    logger.info('STEP 4: CHECK AI QUEUE ENTRY');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: queueEntries, error: queueError } = await supabase
      .from('ai_queue')
      .select('*')
      .eq('raw_job_id', rawJobId);

    if (queueError) {
      logger.error(`✗ Queue query failed: ${queueError.message}`);
      process.exit(1);
    }

    logger.info(`✓ AI queue check completed`);
    logger.info(`  Queue entries for raw_job_id=${rawJobId}: ${(queueEntries || []).length}`);
    if (Array.isArray(queueEntries) && queueEntries.length > 0) {
      const queueItem = queueEntries[0];
      logger.info(`  - ID: ${queueItem.id}`);
      logger.info(`  - Status: ${queueItem.status}`);
      logger.info(`  - Retry count: ${queueItem.retry_count}`);
    }

    if (!Array.isArray(queueEntries) || queueEntries.length === 0) {
      logger.error('✗ No AI queue entry created for this job.');
      process.exit(1);
    }

    logger.info('');

    // ======================== STEP 5: FETCH RAW JOB ========================
    logger.info('STEP 5: FETCH RAW JOB FROM DATABASE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: rawJob, error: rawJobError } = await supabase
      .from('raw_jobs')
      .select('*')
      .eq('id', rawJobId)
      .single();

    if (rawJobError) {
      logger.error(`✗ Raw job fetch failed: ${rawJobError.message}`);
      process.exit(1);
    }

    logger.info(`✓ Raw job fetched from database`);
    logger.info(`  ID: ${rawJob.id}`);
    logger.info(`  Title: ${rawJob.title}`);
    logger.info(`  Apply URL: ${rawJob.apply_url}`);
    logger.info(`  AI Processed: ${rawJob.ai_processed}`);
    logger.info('');

    // ======================== STEP 6: RUN AI WORKER ========================
    logger.info('STEP 6: RUN AI ENRICHMENT');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const aiResult = await runAiWorker({
      logger,
      batchSize: 1,
      rawJobIds: [rawJobId],
    });

    logger.info(`✓ AI Worker completed`);
    logger.info(`  Loaded: ${aiResult.jobsLoaded}`);
    logger.info(`  Completed: ${aiResult.jobsCompleted}`);
    logger.info(`  Failed: ${aiResult.jobsFailed}`);
    logger.info(`  Processing time: ${aiResult.processingTimeMs}ms`);
    logger.info('');

    // ======================== STEP 7: CHECK PROCESSED JOB ========================
    logger.info('STEP 7: VERIFY PROCESSED JOB IN DATABASE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: processedJobs, error: processedError } = await supabase
      .from('processed_jobs')
      .select('*')
      .eq('raw_job_id', rawJobId);

    if (processedError) {
      logger.error(`✗ Processed job query failed: ${processedError.message}`);
      process.exit(1);
    }

    logger.info(`✓ Processed job check completed`);
    logger.info(`  Found: ${(processedJobs || []).length} processed job(s)`);

    if (Array.isArray(processedJobs) && processedJobs.length > 0) {
      const processed = processedJobs[0];
      logger.info(`  - ID: ${processed.id}`);
      logger.info(`  - Title: ${processed.title}`);
      logger.info(`  - Summary: ${processed.summary ? processed.summary.substring(0, 100) + '...' : '(empty)'}`);
      logger.info(`  - Skills: ${processed.skills ? JSON.stringify(processed.skills) : '(empty)'}`);
      logger.info(`  - AI Processed: ${processed.ai_processed}`);
      logger.info(`  - AI Model: ${processed.ai_model}`);
    }

    if (!Array.isArray(processedJobs) || processedJobs.length === 0) {
      logger.error('✗ No processed job found. AI enrichment may have failed.');
      if (aiResult.jobsFailed > 0) {
        logger.info('  (Note: AI Worker reported failures, check logs above)');
      }
    }

    logger.info('');

    // ======================== STEP 8: CHECK RAW JOB UPDATE ========================
    logger.info('STEP 8: VERIFY RAW JOB MARKED AS AI PROCESSED');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: updatedRawJob, error: updatedError } = await supabase
      .from('raw_jobs')
      .select('ai_processed, ai_processed_at')
      .eq('id', rawJobId)
      .single();

    if (updatedError) {
      logger.error(`✗ Updated raw job query failed: ${updatedError.message}`);
      process.exit(1);
    }

    logger.info(`✓ Raw job status check completed`);
    logger.info(`  ai_processed: ${updatedRawJob.ai_processed}`);
    logger.info(`  ai_processed_at: ${updatedRawJob.ai_processed_at}`);

    if (!updatedRawJob.ai_processed) {
      logger.error('✗ Raw job was NOT marked as ai_processed. Enrichment incomplete.');
    }

    logger.info('');

    // ======================== FINAL SUMMARY ========================
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('PART 1: END-TO-END TRACE COMPLETE');
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('');
    logger.info('RESULTS:');
    logger.info(`✓ Job scraped from Microsoft`);
    logger.info(`✓ Duplicate detection completed (${duplicateCount} duplicates found)`);
    logger.info(`✓ New job saved to raw_jobs (ID: ${rawJobId})`);
    logger.info(`✓ AI queue entry created`);
    logger.info(`✓ AI enrichment attempted (${aiResult.jobsCompleted} completed, ${aiResult.jobsFailed} failed)`);
    logger.info(`✓ Processed job ${processedJobs && processedJobs.length > 0 ? 'FOUND' : 'NOT FOUND'} in database`);
    logger.info(`✓ Raw job marked as ai_processed: ${updatedRawJob.ai_processed ? 'YES' : 'NO'}`);
    logger.info('');

    const success = aiResult.jobsCompleted > 0 && 
                    Array.isArray(processedJobs) && 
                    processedJobs.length > 0 && 
                    updatedRawJob.ai_processed;

    if (success) {
      logger.info('✓✓✓ PART 1 VERIFICATION: SUCCESS ✓✓✓');
      logger.info('The complete end-to-end pipeline works correctly.');
    } else {
      logger.info('✗✗✗ PART 1 VERIFICATION: FAILED ✗✗✗');
      logger.info('The pipeline did not complete successfully. Check logs above.');
    }

    process.exit(success ? 0 : 1);

  } catch (error) {
    logger.error('Fatal error in pipeline trace:');
    logger.error(error && error.message ? error.message : String(error));
    if (error && error.stack) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

main();
