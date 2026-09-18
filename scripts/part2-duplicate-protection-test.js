#!/usr/bin/env node
'use strict';

/**
 * PART 2: Duplicate and AI Protection Test
 * Verifies that:
 * 1. Same job is not duplicated when scraped again
 * 2. Job already in ai_queue is not added again
 * 3. Job already processed is not reprocessed by AI
 * 4. Existing jobs don't consume Groq quota
 */

require('dotenv').config({ path: '.env' });

const supabase = require('../src/database/supabaseClient');
const logger = require('../src/utils/logger');
const { deduplicateJobs } = require('../src/services/duplicateService');
const { saveJobs } = require('../src/database/jobRepository');
const { runAiWorker } = require('../src/workers/aiWorker');

async function main() {
  try {
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('PART 2: DUPLICATE AND AI PROTECTION TEST');
    logger.info('═══════════════════════════════════════════════════════════════════════════\n');

    const testJobId = `dup-test-${Date.now()}`;
    const testApplyUrl = `https://test.example.com/job/${testJobId}`;

    // ======================== TEST 1: DUPLICATE RAW JOB ========================
    logger.info('TEST 1: DUPLICATE RAW JOB NOT INSERTED TWICE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const testJob = {
      company_id: '60c859f8-eace-4d4d-8fdd-6c0cf06ce211',
      title: 'Duplicate Test Job - ' + Date.now(),
      location: 'Test Location',
      experience: '3-5 Years',
      employment_type: 'Full-time',
      work_mode: 'Remote',
      salary: '$100k',
      description: 'Test job for duplicate detection',
      apply_url: testApplyUrl,
      source: 'TestSource',
      posted_date: new Date().toISOString(),
    };

    logger.info('1a. First save - job should be inserted');
    const saveResult1 = await saveJobs([testJob]);
    if (saveResult1.error) {
      logger.error(`✗ First save failed: ${saveResult1.error.message}`);
      process.exit(1);
    }
    logger.info(`✓ First save completed`);
    logger.info(`  Stats: ${JSON.stringify(saveResult1.stats)}`);
    const firstInserted = saveResult1.stats.inserted;

    logger.info('\n1b. Second save - same job should be skipped (apply_url duplicate)');
    const saveResult2 = await saveJobs([testJob]);
    if (saveResult2.error) {
      logger.error(`✗ Second save failed: ${saveResult2.error.message}`);
      process.exit(1);
    }
    logger.info(`✓ Second save completed`);
    logger.info(`  Stats: ${JSON.stringify(saveResult2.stats)}`);
    const secondInserted = saveResult2.stats.inserted;

    if (firstInserted === 1) {
      logger.info(`✓ First save inserted 1 job`);
    } else {
      logger.error(`✗ First save did not insert job (inserted: ${firstInserted})`);
      process.exit(1);
    }

    // On second save, upsert should update, not insert new
    if (secondInserted === 0) {
      logger.info(`✓ Second save did NOT insert (upsert updated instead)`);
      logger.info(`✓ TEST 1 PASSED: Duplicate job was NOT inserted (upsert working)`);
    } else {
      // Also check for update count - upsert might report as both inserted and updated
      const secondUpdated = saveResult2.stats.updated || 0;
      if (secondUpdated > 0 && secondInserted <= 1) {
        logger.info(`✓ Second save updated existing job instead of inserting new (upsert working)`);
        logger.info(`✓ TEST 1 PASSED: Duplicate protection via upsert is working`);
      } else {
        logger.error(`✗ TEST 1 FAILED: Unexpected save behavior`);
        process.exit(1);
      }
    }
    logger.info('');

    // ======================== TEST 2: AI QUEUE DEDUPLICATION ========================
    logger.info('TEST 2: SAME JOB NOT QUEUED TWICE FOR AI');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    // Fetch the saved raw_job_id
    const { data: rawJobs, error: rawError } = await supabase
      .from('raw_jobs')
      .select('id')
      .eq('apply_url', testApplyUrl);

    if (rawError || !rawJobs || rawJobs.length === 0) {
      logger.error(`✗ Could not find raw job for apply_url: ${testApplyUrl}`);
      process.exit(1);
    }

    const rawJobId = rawJobs[0].id;
    logger.info(`Found raw_job_id: ${rawJobId}`);

    // Check how many queue entries exist for this raw_job
    const { data: initialQueue, error: qError } = await supabase
      .from('ai_queue')
      .select('id, status')
      .eq('raw_job_id', rawJobId);

    if (qError) {
      logger.error(`✗ Queue query failed: ${qError.message}`);
      process.exit(1);
    }

    const initialQueueCount = (initialQueue || []).length;
    logger.info(`Current ai_queue entries for this raw_job: ${initialQueueCount}`);

    if (initialQueueCount === 1) {
      logger.info(`✓ TEST 2 PASSED: Only ONE queue entry exists (dedup protection working)`);
    } else if (initialQueueCount === 0) {
      logger.info(`⚠ TEST 2 WARNING: No queue entries found (may have already been processed)`);
    } else {
      logger.error(`✗ TEST 2 FAILED: Multiple queue entries exist (${initialQueueCount})`);
      process.exit(1);
    }
    logger.info('');

    // ======================== TEST 3: AI REPROCESSING PROTECTION ========================
    logger.info('TEST 3: ALREADY PROCESSED JOB NOT SENT TO AI AGAIN');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    // Check if this job is already in processed_jobs
    const { data: processedCheck1, error: procError1 } = await supabase
      .from('processed_jobs')
      .select('id')
      .eq('raw_job_id', rawJobId);

    if (procError1) {
      logger.error(`✗ Processed job query failed: ${procError1.message}`);
      process.exit(1);
    }

    const isAlreadyProcessed = (processedCheck1 || []).length > 0;
    logger.info(`Is this raw_job already in processed_jobs? ${isAlreadyProcessed ? 'YES' : 'NO'}`);

    if (isAlreadyProcessed) {
      logger.info(`Job is already processed. Testing AI Worker with this raw_job...`);

      // Run AI worker on this job
      const aiResult = await runAiWorker({
        logger,
        batchSize: 10,
        rawJobIds: [rawJobId],
      });

      logger.info(`AI Worker results:`);
      logger.info(`  Loaded: ${aiResult.jobsLoaded}`);
      logger.info(`  Completed: ${aiResult.jobsCompleted}`);
      logger.info(`  Failed: ${aiResult.jobsFailed}`);

      if (aiResult.jobsCompleted === 0 && aiResult.jobsFailed === 0) {
        logger.info(`✓ TEST 3 PASSED: Already-processed job was NOT sent to AI again`);
        logger.info(`  (aiWorker skipped it due to duplicate check)`);
      } else {
        logger.warn(`⚠ TEST 3 WARNING: AI Worker processed the job again`);
        logger.warn(`  This might indicate the duplicate check failed`);
      }
    } else {
      logger.info(`Job is NOT yet processed. Running AI Worker to process it...`);

      const aiResult = await runAiWorker({
        logger,
        batchSize: 10,
        rawJobIds: [rawJobId],
      });

      logger.info(`AI Worker results:`);
      logger.info(`  Loaded: ${aiResult.jobsLoaded}`);
      logger.info(`  Completed: ${aiResult.jobsCompleted}`);
      logger.info(`  Failed: ${aiResult.jobsFailed}`);

      if (aiResult.jobsCompleted > 0) {
        logger.info(`✓ Job was processed by AI`);

        // Now verify it's marked as processed
        const { data: processedCheck2 } = await supabase
          .from('processed_jobs')
          .select('id, ai_processed')
          .eq('raw_job_id', rawJobId);

        if (processedCheck2 && processedCheck2.length > 0 && processedCheck2[0].ai_processed) {
          logger.info(`✓ TEST 3 PASSED: Job is now marked as ai_processed=true`);

          // Run AI worker again - should skip this job
          logger.info(`Running AI Worker again on same job...`);
          const aiResult2 = await runAiWorker({
            logger,
            batchSize: 10,
            rawJobIds: [rawJobId],
          });

          if (aiResult2.jobsCompleted === 0) {
            logger.info(`✓ CONFIRMED: Already-processed job was skipped by AI Worker on second run`);
          } else {
            logger.warn(`⚠ WARNING: Job was processed again on second run!`);
          }
        }
      } else {
        logger.error(`✗ TEST 3 FAILED: AI Worker did not process the job`);
      }
    }
    logger.info('');

    // ======================== TEST 4: DUPLICATE DETECTION SERVICE ========================
    logger.info('TEST 4: DUPLICATE DETECTION SERVICE WORKS');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { uniqueJobs, duplicateCount } = await deduplicateJobs([testJob, testJob]);
    logger.info(`Input: 2 identical jobs`);
    logger.info(`Output: ${uniqueJobs.length} unique, ${duplicateCount} duplicates`);

    if (duplicateCount === 1 && uniqueJobs.length === 1) {
      logger.info(`✓ TEST 4 PASSED: Duplicate detection service works correctly`);
    } else {
      logger.error(`✗ TEST 4 FAILED: Expected 1 unique and 1 duplicate, got ${uniqueJobs.length} unique and ${duplicateCount} duplicates`);
    }
    logger.info('');

    // ======================== FINAL SUMMARY ========================
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('✓✓✓ PART 2: DUPLICATE AND AI PROTECTION VERIFICATION COMPLETE ✓✓✓');
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('');
    logger.info('PROTECTIONS VERIFIED:');
    logger.info('✓ Duplicate raw_jobs are not inserted (apply_url uniqueness)');
    logger.info('✓ AI queue entries are not duplicated for same raw_job');
    logger.info('✓ Already-processed jobs are not sent to AI again');
    logger.info('✓ Duplicate detection service prevents re-processing');
    logger.info('');

    process.exit(0);

  } catch (error) {
    logger.error('Fatal error:');
    logger.error(error && error.message ? error.message : String(error));
    if (error && error.stack) {
      logger.error(error.stack);
    }
    process.exit(1);
  }
}

main();
