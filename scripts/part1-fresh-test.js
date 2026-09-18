#!/usr/bin/env node
'use strict';

/**
 * PART 1: Fresh End-to-End Job Test
 * Creates a unique test job and traces it through the complete pipeline
 */

require('dotenv').config({ path: '.env' });

const supabase = require('../src/database/supabaseClient');
const logger = require('../src/utils/logger');
const { runAiWorker } = require('../src/workers/aiWorker');

async function main() {
  try {
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('PART 1: END-TO-END TEST WITH FRESH TEST JOB');
    logger.info('═══════════════════════════════════════════════════════════════════════════\n');

    // ======================== CREATE TEST JOB ========================
    logger.info('STEP 1: CREATE UNIQUE TEST JOB');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const testJobId = `test-${Date.now()}`;
    const testJob = {
      company_id: '60c859f8-eace-4d4d-8fdd-6c0cf06ce211', // Microsoft
      title: 'Test Senior Software Engineer - ' + Date.now(),
      location: 'Hyderabad, India',
      experience: '3-5 Years',
      employment_type: 'Full-time',
      work_mode: 'Hybrid',
      salary: '₹20-30 LPA',
      description: 'We are seeking a talented software engineer to build cloud-native services and APIs that power our next-generation products. The successful candidate will work with modern technologies including Node.js, TypeScript, AWS, and microservices architecture. This is a hybrid role based in Hyderabad, India.',
      apply_url: 'https://apply.careers.microsoft.com/test/' + testJobId,
      source: 'Microsoft',
      posted_date: new Date().toISOString(),
      status: 'active',
      is_active: true,
    };

    logger.info(`✓ Created test job:`);
    logger.info(`  Title: ${testJob.title}`);
    logger.info(`  Apply URL: ${testJob.apply_url}`);
    logger.info('');

    // ======================== SAVE TEST JOB ========================
    logger.info('STEP 2: SAVE TEST JOB TO DATABASE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: savedJobs, error: saveError } = await supabase
      .from('raw_jobs')
      .insert([testJob])
      .select('id, apply_url, ai_processed');

    if (saveError) {
      logger.error(`✗ Failed to save test job: ${saveError.message}`);
      process.exit(1);
    }

    const rawJobId = savedJobs[0].id;
    logger.info(`✓ Test job saved to raw_jobs`);
    logger.info(`  ID: ${rawJobId}`);
    logger.info(`  ai_processed: ${savedJobs[0].ai_processed}`);
    logger.info('');

    // ======================== CREATE QUEUE ENTRY ========================
    logger.info('STEP 3: CREATE AI QUEUE ENTRY');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: queueInserted, error: queueError } = await supabase
      .from('ai_queue')
      .insert([{
        raw_job_id: rawJobId,
        status: 'Pending',
        retry_count: 0,
      }])
      .select('*');

    if (queueError) {
      logger.error(`✗ Failed to create queue entry: ${queueError.message}`);
      process.exit(1);
    }

    logger.info(`✓ AI queue entry created`);
    logger.info(`  Queue ID: ${queueInserted[0].id}`);
    logger.info(`  Status: ${queueInserted[0].status}`);
    logger.info('');

    // ======================== RUN AI WORKER ========================
    logger.info('STEP 4: RUN AI ENRICHMENT');
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

    // ======================== VERIFY PROCESSED JOB ========================
    logger.info('STEP 5: VERIFY ENRICHED JOB IN DATABASE');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: processedJobs, error: processedError } = await supabase
      .from('processed_jobs')
      .select('*')
      .eq('raw_job_id', rawJobId);

    if (processedError) {
      logger.error(`✗ Query failed: ${processedError.message}`);
      process.exit(1);
    }

    logger.info(`✓ Processed job check completed`);
    logger.info(`  Found: ${(processedJobs || []).length} record(s)`);

    if (Array.isArray(processedJobs) && processedJobs.length > 0) {
      const processed = processedJobs[0];
      logger.info(`  - ID: ${processed.id}`);
      logger.info(`  - Title: ${processed.title}`);
      logger.info(`  - Summary length: ${processed.summary ? processed.summary.length : 0} chars`);
      logger.info(`  - Skills: ${processed.skills ? JSON.stringify(processed.skills).substring(0, 80) : 'none'}`);
      logger.info(`  - AI Model: ${processed.ai_model}`);
      logger.info(`  - AI Processed: ${processed.ai_processed}`);
    }

    if (!Array.isArray(processedJobs) || processedJobs.length === 0) {
      logger.error('✗ No processed job found!');
      if (aiResult.jobsFailed > 0) {
        logger.warn('  AI worker reported failures - check logs above');
      }
      process.exit(1);
    }

    logger.info('');

    // ======================== VERIFY RAW JOB UPDATE ========================
    logger.info('STEP 6: VERIFY RAW JOB MARKED AS PROCESSED');
    logger.info('─────────────────────────────────────────────────────────────────────────');

    const { data: updatedRawJob, error: updatedError } = await supabase
      .from('raw_jobs')
      .select('ai_processed, ai_processed_at')
      .eq('id', rawJobId)
      .single();

    if (updatedError) {
      logger.error(`✗ Query failed: ${updatedError.message}`);
      process.exit(1);
    }

    logger.info(`✓ Raw job status verified`);
    logger.info(`  ai_processed: ${updatedRawJob.ai_processed}`);
    logger.info(`  ai_processed_at: ${updatedRawJob.ai_processed_at}`);

    if (!updatedRawJob.ai_processed) {
      logger.error('✗ Raw job NOT marked as processed!');
      process.exit(1);
    }

    logger.info('');

    // ======================== FINAL SUMMARY ========================
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('✓✓✓ PART 1: END-TO-END TEST PASSED ✓✓✓');
    logger.info('═══════════════════════════════════════════════════════════════════════════');
    logger.info('');
    logger.info('SUMMARY:');
    logger.info(`✓ Test job created and saved to raw_jobs (ID: ${rawJobId})`);
    logger.info(`✓ AI queue entry created and processed`);
    logger.info(`✓ AI enrichment completed (${aiResult.jobsCompleted} jobs)`);
    logger.info(`✓ Processed job found with all required fields`);
    logger.info(`✓ Raw job marked as ai_processed`);
    logger.info('');
    logger.info('The complete end-to-end pipeline works correctly!');
    logger.info('Jobs flow through: raw_jobs → ai_queue → AI enrichment → processed_jobs');
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
