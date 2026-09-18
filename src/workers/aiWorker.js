'use strict';

const supabase = require('../database/supabaseClient');
const logger = require('../utils/logger');
const { createJobEnricher } = require('../ai');
const { mergeEnrichment } = require('../ai/jobExtractor');
const { buildEnrichmentPrompt } = require('../ai/promptBuilder');
const { parseEnrichmentResponse } = require('../ai/responseParser');
const { callOllama } = require('../ai/ollamaClient');
const { callGroq, GroqQuotaError } = require('../ai/groqClient');
const { publishPendingJobs } = require('../publisher/publisher');
const { normalizeWorkMode, normalizeJobWorkMode } = require('../utils/workModeNormalizer');
const { normalizeExperience, normalizeEmploymentType, normalizeLocationForWorkMode } = require('../utils/processedJobNormalizer');
const { generateCategory } = require('../utils/categoryNormalizer');
const { normalizeSalary } = require('../utils/salaryNormalizer');
const { detectEducation } = require('../utils/educationNormalizer');

const enrichJob = createJobEnricher({ logger });
const DEFAULT_AI_JOB_TIMEOUT_MS = 120000;

function getAiJobTimeoutMs() {
  const configuredTimeout = Number(process.env.AI_JOB_TIMEOUT_MS || DEFAULT_AI_JOB_TIMEOUT_MS);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_AI_JOB_TIMEOUT_MS;
}

function getProcessingRecoveryTimeoutMs() {
  const configuredTimeout = Number(process.env.AI_PROCESSING_STALE_TIMEOUT_MS || 15 * 60 * 1000);
  return Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15 * 60 * 1000;
}

async function recoverStaleProcessing(options = {}) {
  const activeSupabase = options.supabase || supabase;
  const loggerInstance = options.logger || logger;
  const cutoff = new Date(Date.now() - getProcessingRecoveryTimeoutMs()).toISOString();
  const { data: staleRows, error: loadError } = await activeSupabase
    .from('ai_queue')
    .select('id,retry_count')
    .eq('status', 'Processing')
    .lt('updated_at', cutoff);

  if (loadError) throw loadError;

  let recovered = 0;
  for (const row of Array.isArray(staleRows) ? staleRows : []) {
    const retryCount = Number(row.retry_count || 0) + 1;
    const nextStatus = retryCount >= 3 ? 'Failed' : 'Pending';
    const { error } = await activeSupabase
      .from('ai_queue')
      .update({
        status: nextStatus,
        retry_count: retryCount,
        last_error: 'Recovered stale Processing queue item',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'Processing');
    if (error) throw error;
    recovered += 1;
  }

  if (recovered > 0) {
    loggerInstance.warn(`Recovered ${recovered} stale AI queue Processing entries`);
  }
  return { recovered };
}

function logAiStage(loggerInstance, stage, rawJob, startedAt) {
  loggerInstance.info(JSON.stringify({
    event: 'ai_stage',
    jobId: rawJob?.id || null,
    applyUrl: rawJob?.apply_url || null,
    source: rawJob?.source || null,
    companyId: rawJob?.company_id || null,
    stage,
    elapsedMs: Date.now() - startedAt,
  }));
}

function getBackoffDelayMs(retryCount) {
  const delays = [0, 60_000, 5 * 60_000, 15 * 60_000];
  return delays[Math.min(Number(retryCount) || 0, delays.length - 1)] || 0;
}

function isQueueItemReady(queueItem) {
  if (!queueItem || typeof queueItem !== 'object') {
    return false;
  }

  if (queueItem.status !== 'Pending') {
    return false;
  }

  const retryCount = Number(queueItem.retry_count || 0);
  const delayMs = getBackoffDelayMs(retryCount);
  if (delayMs <= 0) {
    return true;
  }

  const updatedAt = queueItem.updated_at ? new Date(queueItem.updated_at).getTime() : 0;
  return Date.now() - updatedAt >= delayMs;
}

function getAIModel() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (provider === 'groq') {
    return process.env.GROQ_MODEL || 'unknown';
  }
  if (provider === 'ollama') {
    return process.env.OLLAMA_MODEL || 'unknown';
  }
  return 'unknown';
}

function mapRawJobToProcessedJob(rawJob) {
  if (!rawJob || typeof rawJob !== 'object') {
    return null;
  }

  const normalizedWorkMode = normalizeLocationForWorkMode(rawJob.location, rawJob.work_mode);
  const normalizedSalary = normalizeSalary(rawJob.salary);
  const detectedWorkMode = normalizeJobWorkMode(rawJob);

  return {
    raw_job_id: rawJob.id,
    company_id: rawJob.company_id || null,
    title: rawJob.title || null,
    location: rawJob.location || null,
    experience: normalizeExperience(rawJob.experience),
    employment_type: normalizeEmploymentType(rawJob.employment_type),
    work_mode: detectedWorkMode || normalizeWorkMode(normalizedWorkMode.workMode),
    category: generateCategory(rawJob),
    education: detectEducation(rawJob),
    salary: normalizedSalary.salary,
    currency: normalizedSalary.currency,
    description: rawJob.description || null,
    summary: rawJob.summary || null,
    skills: rawJob.skills || null,
    responsibilities: rawJob.responsibilities || null,
    benefits: rawJob.benefits || null,
    apply_url: rawJob.apply_url || null,
    source: rawJob.source || null,
    posted_date: rawJob.posted_date || null,
    expiry_date: rawJob.expiry_date || rawJob.expiryDate || null,
    status: rawJob.status || 'active',
    is_active: rawJob.is_active !== false,
    ai_processed: true,
    ai_model: getAIModel(),
    ai_processed_at: new Date().toISOString(),
  };
}

function buildProcessedJobInsertPayload(processedJobPayload) {
  if (!processedJobPayload || typeof processedJobPayload !== 'object') {
    return processedJobPayload;
  }

  const insertPayload = { ...processedJobPayload };
  delete insertPayload.responsibilities;
  delete insertPayload.benefits;
  return insertPayload;
}

async function runSingleJobDebug(rawJobId, options = {}) {
  const loggerInstance = options.logger || logger;
  const startedAt = Date.now();

  if (!rawJobId) {
    throw new Error('A raw_job_id is required for debug mode');
  }

  loggerInstance.info(`AI Worker Debug Mode Started for raw_job_id: ${rawJobId}`);

  const { data: rawJobRows, error: rawJobError } = await supabase
    .from('raw_jobs')
    .select('*')
    .eq('id', rawJobId)
    .single();

  if (rawJobError || !rawJobRows) {
    throw rawJobError || new Error('Raw job not found');
  }

  loggerInstance.info('=== ORIGINAL RAW JOB ===');
  loggerInstance.info(JSON.stringify(rawJobRows, null, 2));

  const provider = (process.env.AI_PROVIDER || '').toLowerCase().trim();
  const providerClient = provider === 'groq' ? (options.groqClient || callGroq) : (options.ollamaClient || callOllama);
  const prompt = buildEnrichmentPrompt(rawJobRows, [
    'description', 'summary', 'responsibilities', 'benefits', 'skills', 'experience', 'employment_type', 'salary', 'work_mode',
  ]);

  const aiResponseText = await providerClient(prompt, { logger: loggerInstance, ...options });
  const parsedResponse = typeof aiResponseText === 'string'
    ? parseEnrichmentResponse(aiResponseText)
    : aiResponseText && typeof aiResponseText === 'object' && !Array.isArray(aiResponseText)
      ? aiResponseText
      : parseEnrichmentResponse(String(aiResponseText || ''));
  const mergedJob = mergeEnrichment(rawJobRows, parsedResponse);

  loggerInstance.info('=== AI RESPONSE ===');
  loggerInstance.info(typeof aiResponseText === 'string' ? aiResponseText : JSON.stringify(aiResponseText, null, 2));

  const processedJobPayload = mapRawJobToProcessedJob({ ...rawJobRows, ...mergedJob });
  if (!processedJobPayload) {
    throw new Error('Processed job payload could not be built');
  }

  loggerInstance.info('=== FINAL PROCESSED JOB PAYLOAD ===');
  loggerInstance.info(JSON.stringify(processedJobPayload, null, 2));

  const insertPayload = buildProcessedJobInsertPayload(processedJobPayload);

  if (processedJobPayload.apply_url) {
    const { data: existingApplyUrlRow, error: existingApplyUrlError } = await supabase
      .from('processed_jobs')
      .select('id, raw_job_id')
      .eq('apply_url', processedJobPayload.apply_url)
      .maybeSingle();

    if (existingApplyUrlError) {
      throw existingApplyUrlError;
    }

    if (existingApplyUrlRow) {
      loggerInstance.info('=== DUPLICATE processed_jobs SKIPPED ===');
      loggerInstance.info(`Existing processed_jobs id: ${existingApplyUrlRow.id}`);
      loggerInstance.info(`Existing processed_jobs raw_job_id: ${existingApplyUrlRow.raw_job_id}`);
      return {
        jobsLoaded: 1,
        jobsCompleted: 0,
        jobsFailed: 0,
        processingTimeMs: Date.now() - startedAt,
        insertedRow: null,
        processedJobPayload,
        duplicateApplyUrl: true,
        existingProcessedJobId: existingApplyUrlRow.id,
      };
    }
  }

  const { data: insertData, error: insertError } = await supabase
    .from('processed_jobs')
    .insert(insertPayload);

  if (insertError) {
    throw insertError;
  }

  loggerInstance.info('=== GENERATED FIELDS ===');
  loggerInstance.info(JSON.stringify({
    description: processedJobPayload.description,
    summary: processedJobPayload.summary,
    responsibilities: processedJobPayload.responsibilities,
    benefits: processedJobPayload.benefits,
    skills: processedJobPayload.skills,
    experience: processedJobPayload.experience,
    employment_type: processedJobPayload.employment_type,
    salary: processedJobPayload.salary,
    work_mode: processedJobPayload.work_mode,
  }, null, 2));

  return {
    jobsLoaded: 1,
    jobsCompleted: 1,
    jobsFailed: 0,
    processingTimeMs: Date.now() - startedAt,
    insertedRow: insertData,
    processedJobPayload,
  };
}

async function runAiWorker(options = {}) {
  const loggerInstance = options.logger || logger;
  const batchSize = options.batchSize || 10;
  const rawJobIds = Array.isArray(options.rawJobIds) ? options.rawJobIds.filter(Boolean) : [];
  const startedAt = Date.now();
  const debugMode = Boolean(options.debug || options.rawJobId);
  const metrics = {
    pendingCount: null,
    fetchedCount: 0,
    eligibleCount: 0,
    skippedBackoffCount: 0,
    claimedCount: 0,
    completedCount: 0,
    failedCount: 0,
    aiDurationsMs: [],
  };

  loggerInstance.info('AI Worker Started');
  loggerInstance.info(`AI Worker batchSize: ${batchSize}`);
  if (rawJobIds.length) {
    loggerInstance.info(`AI Worker rawJobIds filter count: ${rawJobIds.length}`);
  }

  try {
    if (debugMode) {
      return runSingleJobDebug(options.rawJobId, options);
    }
    await recoverStaleProcessing({ logger: loggerInstance, supabase });
    let query = supabase
      .from('ai_queue')
      .select('*')
      .eq('status', 'Pending');

    if (rawJobIds.length) {
      query = query.in('raw_job_id', rawJobIds);
    }

    const { count: pendingCount, error: pendingCountError } = await supabase
      .from('ai_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Pending');
    metrics.pendingCount = pendingCount ?? null;
    if (pendingCountError) {
      loggerInstance.warn(`AI Worker pending count failed: ${pendingCountError.message}`);
    }

    const { data: queueItems, error: queueError } = await query
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (queueError) {
      loggerInstance.error(`AI Worker queue load failed: ${queueError.message}`);
      return { jobsLoaded: 0, jobsCompleted: 0, jobsFailed: 0, processingTimeMs: Date.now() - startedAt };
    }

    metrics.fetchedCount = Array.isArray(queueItems) ? queueItems.length : 0;
    loggerInstance.info(`AI Worker fetched Pending queue rows: ${metrics.fetchedCount}`);

    const queueRows = (Array.isArray(queueItems) ? queueItems : []).filter((item) => isQueueItemReady(item));
    metrics.eligibleCount = queueRows.length;
    metrics.skippedBackoffCount = metrics.fetchedCount - metrics.eligibleCount;
    loggerInstance.info(`AI Worker queueItems count before readiness filter: ${metrics.fetchedCount}`);
    loggerInstance.info(`AI Worker queueRows count after readiness filter: ${queueRows.length}`);
    loggerInstance.info(`AI Worker skipped due to retry/backoff: ${metrics.skippedBackoffCount}`);
    loggerInstance.info(`\n╔════════════════════════════════════════════════════════════════╗`);
    loggerInstance.info(`║ JOBS LOADED FROM ai_queue: ${queueRows.length}`);
    loggerInstance.info(`╚════════════════════════════════════════════════════════════════╝\n`);

    let jobsCompleted = 0;
    let jobsFailed = 0;

    for (const queueItem of queueRows) {
      try {
        const rawJobId = queueItem?.raw_job_id;
        if (!rawJobId) {
          throw new Error('Missing raw_job_id');
        }

        loggerInstance.info(`\n──────────────────────────────────────────────────────────────`);
        loggerInstance.info(`PROCESSING raw_job_id: ${rawJobId}`);
        loggerInstance.info(`Queue Item ID: ${queueItem.id}`);
        loggerInstance.info(`──────────────────────────────────────────────────────────────\n`);
        const jobStartedAt = Date.now();
        logAiStage(loggerInstance, 'queue_item_loaded', { id: rawJobId }, jobStartedAt);

        const { data: existingProcessedRows, error: duplicateCheckError } = await supabase
          .from('processed_jobs')
          .select('raw_job_id')
          .eq('raw_job_id', rawJobId);

        if (duplicateCheckError) {
          throw duplicateCheckError;
        }

        loggerInstance.info(`✓ STEP 1: Duplicate Check`);
        loggerInstance.info(`  Existing records: ${Array.isArray(existingProcessedRows) ? existingProcessedRows.length : 0}`);

        if (Array.isArray(existingProcessedRows) && existingProcessedRows.length > 0) {
          loggerInstance.info(`  → Skipping (already processed)\n`);
          await supabase
            .from('ai_queue')
            .update({
              status: 'Completed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', queueItem.id);
          jobsCompleted += 1;
          metrics.completedCount = jobsCompleted;
          continue;
        }

        const { data: rawJobRows, error: rawJobError } = await supabase
          .from('raw_jobs')
          .select('*')
          .eq('id', rawJobId)
          .single();

        if (rawJobError || !rawJobRows) {
          throw rawJobError || new Error('Raw job not found');
        }
        logAiStage(loggerInstance, 'raw_job_loaded', rawJobRows, jobStartedAt);

        const { data: claimedQueueRows, error: claimError } = await supabase
          .from('ai_queue')
          .update({
            status: 'Processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id)
          .eq('status', 'Pending')
          .select('id,status');

        loggerInstance.info(`Attempting to claim queue item id=${queueItem.id} status=Pending`);
        if (claimError) {
          loggerInstance.error(`Queue claim failed for id=${queueItem.id}: ${claimError.message}`);
          throw claimError;
        }

        if (!Array.isArray(claimedQueueRows) || claimedQueueRows.length === 0) {
          loggerInstance.info(`  → Queue item was claimed by another worker; skipping`);
          continue;
        }
        metrics.claimedCount += claimedQueueRows.length;

        logAiStage(loggerInstance, 'prompt_payload_prepared', rawJobRows, jobStartedAt);

        loggerInstance.info(`✓ STEP 2: Fetched Raw Job`);
        loggerInstance.info(`  Title: ${rawJobRows.title}`);
        loggerInstance.info(`  Description: ${rawJobRows.description?.substring(0, 50)}...`);

        logAiStage(loggerInstance, 'groq_request_started', rawJobRows, jobStartedAt);
        const aiTimeoutMs = getAiJobTimeoutMs();
        const remainingAiTimeoutMs = Math.max(1, aiTimeoutMs - (Date.now() - jobStartedAt));
        const aiStartedAt = Date.now();
        const enrichedJob = await enrichJob(rawJobRows, { timeoutMs: remainingAiTimeoutMs });
        metrics.aiDurationsMs.push(Date.now() - aiStartedAt);
        logAiStage(loggerInstance, 'groq_response_received', rawJobRows, jobStartedAt);
        logAiStage(loggerInstance, 'ai_response_parsed', rawJobRows, jobStartedAt);

        loggerInstance.info(`✓ STEP 3: Groq Enrichment Complete`);
        loggerInstance.info(`  Returned Fields:`, Object.keys(enrichedJob));
        loggerInstance.info(`  Enriched Data:`, enrichedJob);

        const processedJobPayload = mapRawJobToProcessedJob({ ...rawJobRows, ...enrichedJob });

        if (!processedJobPayload) {
          throw new Error('Processed job payload could not be built');
        }

        loggerInstance.info(`✓ STEP 4: Built Processed Job Payload`);
        loggerInstance.info(`  Payload Keys:`, Object.keys(processedJobPayload));
        loggerInstance.info(`  raw_job_id: ${processedJobPayload.raw_job_id}`);
        loggerInstance.info(`  title: ${processedJobPayload.title}`);
        loggerInstance.info(`  ai_processed: ${processedJobPayload.ai_processed}`);
        loggerInstance.info(`  ai_model: ${processedJobPayload.ai_model}`);
        loggerInstance.info(`  Payload:`, JSON.stringify(processedJobPayload, null, 2));

        const insertPayload = buildProcessedJobInsertPayload(processedJobPayload);

        if (processedJobPayload.apply_url) {
          const { data: existingApplyUrlRow, error: existingApplyUrlError } = await supabase
            .from('processed_jobs')
            .select('id, raw_job_id')
            .eq('apply_url', processedJobPayload.apply_url)
            .maybeSingle();

          if (existingApplyUrlError) {
            loggerInstance.error(`  ✗ APPLY_URL DUPLICATE CHECK FAILED: ${existingApplyUrlError.message}`);
            throw existingApplyUrlError;
          }

          if (existingApplyUrlRow) {
            loggerInstance.info('  ✓ Duplicate apply_url already exists in processed_jobs');
            loggerInstance.info(`  → Existing processed_jobs id: ${existingApplyUrlRow.id}`);
            loggerInstance.info('  → Marking raw job and queue as completed without inserting duplicate processed_job');

            await supabase
              .from('ai_queue')
              .update({
                status: 'Completed',
                updated_at: new Date().toISOString(),
              })
              .eq('id', queueItem.id);

            await supabase
              .from('raw_jobs')
              .update({
                ai_processed: true,
                ai_processed_at: new Date().toISOString(),
              })
              .eq('id', rawJobId);

            jobsCompleted += 1;
            continue;
          }
        }

        logAiStage(loggerInstance, 'processed_jobs_write_started', rawJobRows, jobStartedAt);
        const { data: insertData, error: insertError } = await supabase
          .from('processed_jobs')
          .insert(insertPayload);
        logAiStage(loggerInstance, 'processed_jobs_write_completed', rawJobRows, jobStartedAt);

        loggerInstance.info(`✓ STEP 5: Insert into processed_jobs`);
        if (insertError) {
          loggerInstance.error(`  ✗ INSERT ERROR: ${insertError.message}`);
          loggerInstance.error(`  Error Code: ${insertError.code}`);
          loggerInstance.error(`  Error Details:`, insertError);
          throw insertError;
        }
        loggerInstance.info(`  Insert Data:`, insertData);
        loggerInstance.info(`  ✓ Successfully inserted`);

        logAiStage(loggerInstance, 'ai_queue_status_update_started', rawJobRows, jobStartedAt);
        const { data: queueUpdateData, error: queueUpdateError } = await supabase
          .from('ai_queue')
          .update({
            status: 'Completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);
        logAiStage(loggerInstance, 'ai_queue_status_update_completed', rawJobRows, jobStartedAt);

        loggerInstance.info(`✓ STEP 6: Mark ai_queue as Completed`);
        if (queueUpdateError) {
          loggerInstance.error(`  ✗ QUEUE UPDATE ERROR: ${queueUpdateError.message}`);
          throw queueUpdateError;
        }
        loggerInstance.info(`  Queue Update Data:`, queueUpdateData);
        loggerInstance.info(`  ✓ Queue item marked completed`);

        logAiStage(loggerInstance, 'raw_jobs_ai_processed_update_started', rawJobRows, jobStartedAt);
        const { data: rawJobUpdateData, error: rawJobUpdateError } = await supabase
          .from('raw_jobs')
          .update({
            ai_processed: true,
            ai_processed_at: new Date().toISOString(),
          })
          .eq('id', rawJobId);
        logAiStage(loggerInstance, 'raw_jobs_ai_processed_update_completed', rawJobRows, jobStartedAt);

        loggerInstance.info(`✓ STEP 7: Update raw_jobs.ai_processed`);
        if (rawJobUpdateError) {
          loggerInstance.error(`  ✗ RAW_JOBS UPDATE ERROR: ${rawJobUpdateError.message}`);
          throw rawJobUpdateError;
        }
        loggerInstance.info(`  Raw Jobs Update Data:`, rawJobUpdateData);
        loggerInstance.info(`  ✓ raw_jobs marked as processed\n`);

        jobsCompleted += 1;
        metrics.completedCount = jobsCompleted;
      } catch (error) {
        jobsFailed += 1;
        metrics.failedCount = jobsFailed;
        
        // Check if it's a quota error
        const isQuotaError = error instanceof GroqQuotaError || error.isQuotaError === true;
        
        loggerInstance.error(`\n╔════════════════════════════════════════════════════════════════╗`);
        loggerInstance.error(`║ ✗ PIPELINE FAILED FOR raw_job_id: ${queueItem?.raw_job_id}`);
        loggerInstance.error(`╠════════════════════════════════════════════════════════════════╣`);
        loggerInstance.error(`║ Error: ${error.message}`);
        if (isQuotaError) {
          loggerInstance.error(`║ Type: QUOTA ERROR - AI processing stopped`);
        }
        loggerInstance.error(`║ Stack: ${error.stack}`);
        loggerInstance.error(`╚════════════════════════════════════════════════════════════════╝\n`);

        // For quota errors: immediately mark as Failed and stop processing
        // For other errors: use backoff retry (up to 3 attempts)
        let nextRetryCount, shouldFail;
        
        if (isQuotaError) {
          shouldFail = true;
          nextRetryCount = (queueItem.retry_count || 0) + 1;
          loggerInstance.error(`QUOTA EXHAUSTED - Marking job as Failed and stopping AI processing`);
        } else {
          nextRetryCount = (queueItem.retry_count || 0) + 1;
          shouldFail = nextRetryCount >= 3;
        }
        
        const { error: queueFailError } = await supabase
          .from('ai_queue')
          .update({
            status: shouldFail ? 'Failed' : 'Pending',
            retry_count: nextRetryCount,
            last_error: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', queueItem.id);

        if (queueFailError) {
          loggerInstance.error(`Failed to update ai_queue with retry status: ${queueFailError.message}`);
        } else if (shouldFail) {
          loggerInstance.warn(`Queue item marked Failed after ${nextRetryCount} attempts`);
        } else {
          loggerInstance.warn(`Queue item re-queued for retry ${nextRetryCount}/3`);
        }
        
        // If quota error, stop processing remaining jobs
        if (isQuotaError) {
          loggerInstance.error(`\n╔════════════════════════════════════════════════════════════════╗`);
          loggerInstance.error(`║ STOPPING AI WORKER - GROQ QUOTA EXHAUSTED ║`);
          loggerInstance.error(`║ ${jobsCompleted} jobs completed, ${jobsFailed} failed ║`);
          loggerInstance.error(`╚════════════════════════════════════════════════════════════════╝\n`);
          break; // Stop processing remaining queue items
        }
      }
    }

    loggerInstance.info(`\n╔════════════════════════════════════════════════════════════════╗`);
    loggerInstance.info(`║ PIPELINE SUMMARY`);
    loggerInstance.info(`╠════════════════════════════════════════════════════════════════╣`);
    loggerInstance.info(`║ Jobs Loaded: ${queueRows.length}`);
    loggerInstance.info(`║ Jobs Completed: ${jobsCompleted}`);
    loggerInstance.info(`║ Jobs Failed: ${jobsFailed}`);
    loggerInstance.info(`║ Processing Time: ${Date.now() - startedAt}ms`);
    loggerInstance.info(`╚════════════════════════════════════════════════════════════════╝\n`);
    const averageAiDurationMs = metrics.aiDurationsMs.length > 0
      ? Math.round(metrics.aiDurationsMs.reduce((sum, duration) => sum + duration, 0) / metrics.aiDurationsMs.length)
      : 0;
    loggerInstance.info(JSON.stringify({
      event: 'ai_worker_cycle_metrics',
      pendingCount: metrics.pendingCount,
      fetchedCount: metrics.fetchedCount,
      eligibleCount: metrics.eligibleCount,
      claimedCount: metrics.claimedCount,
      completedCount: metrics.completedCount,
      failedCount: metrics.failedCount,
      skippedBackoffCount: metrics.skippedBackoffCount,
      averageAiDurationMs,
      batchDurationMs: Date.now() - startedAt,
    }));

    if (jobsCompleted > 0) {
      loggerInstance.info('✓ Batch complete: publishing pending jobs once');
      try {
        await publishPendingJobs({ logger: loggerInstance, supabase });
        loggerInstance.info('✓ Publisher completed after batch');
      } catch (publishError) {
        loggerInstance.error(`Publisher failed after batch: ${publishError.message}`);
      }
    } else {
      loggerInstance.info('No jobs completed in this batch; skipping publish step');
    }

    return {
      jobsLoaded: queueRows.length,
      jobsCompleted,
      jobsFailed,
      processingTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    loggerInstance.error(`AI Worker failed: ${error.message}`);
    return {
      jobsLoaded: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      processingTimeMs: Date.now() - startedAt,
    };
  }
}

module.exports = {
  runAiWorker,
  mapRawJobToProcessedJob,
  recoverStaleProcessing,
};
