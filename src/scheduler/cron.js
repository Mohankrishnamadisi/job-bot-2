const cron = require('node-cron');
const logger = require('../utils/logger');
const { companyCareerUrls, scraperBatchSize, jobScrapeCron, companyScraperTimeoutMs } = require('../config/env');
const { runScrapers, getRegisteredScraperKeys } = require('../scrapers');
const { deduplicateJobs } = require('../services/duplicateService');
const { saveJobs } = require('../database/jobRepository');
const { runAiWorker } = require('../workers/aiWorker');

let importHclJobs = null;
let importTcsJobs = null;

try {
  ({ importHclJobs } = require('../services/jobs/fetchHclJobs'));
} catch (error) {
  logger.warn(`HCL import module unavailable: ${error.message}`);
}

try {
  ({ importTcsJobs } = require('../services/fetchTcsJobs'));
} catch (error) {
  logger.warn(`TCS import module unavailable: ${error.message}`);
}

const JOB_SCHEDULES = Array.isArray(jobScrapeCron) && jobScrapeCron.length > 0
  ? jobScrapeCron
  : [jobScrapeCron || '0 0 * * *'];
const CONTINUOUS_PIPELINE_INTERVAL_MS = Number(process.env.PIPELINE_LOOP_MS || process.env.SCRAPE_INTERVAL_MS || 60 * 60 * 1000) || 60 * 60 * 1000;
let pipelineRunning = false;
let cycleNumber = 0;

function normalizeJobKey(job) {
  const applyUrl = (job.applyUrl || job.apply_url)?.trim().toLowerCase();
  const titleCompany = `${job.title?.trim().toLowerCase() || ''}::${job.company?.trim().toLowerCase() || ''}`;
  return applyUrl || titleCompany;
}

function deduplicateScrapedJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = normalizeJobKey(job);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function resolveScraperTargets() {
  if (Array.isArray(companyCareerUrls) && companyCareerUrls.length > 0) {
    return companyCareerUrls;
  }

  const registeredScrapers = getRegisteredScraperKeys();
  logger.warn(
    `COMPANY_CAREERS_URLS is empty; falling back to registered scrapers: ${registeredScrapers.join(',')}`
  );
  return registeredScrapers;
}

function logCompanyTiming(target, stats) {
  logger.info(
    `Company: ${target} Started=${stats.startedAt} PagesFetched=${stats.pagesFetched ?? 0} ListingJobsFetched=${stats.listingJobsFetched ?? 0} DetailJobsFetched=${stats.detailJobsFetched ?? 0} RecentJobs=${stats.recentJobs ?? 0} Duplicates=${stats.duplicates ?? 0} NewJobsSaved=${stats.newJobsSaved ?? 0} Duration=${stats.durationMs ?? 0}ms StopReason=${stats.stopReason || 'completed'}`
  );
}

async function runJobPipeline() {
  if (pipelineRunning) {
    logger.warn('Job pipeline already running; skipping overlapping execution');
    return;
  }

  pipelineRunning = true;
  cycleNumber += 1;
  const currentCycleNumber = cycleNumber;
  const pipelineStartedAt = Date.now();
  logger.info(`CYCLE_STARTED cycle=${currentCycleNumber} timestamp=${new Date(pipelineStartedAt).toISOString()}`);

  try {
    const batchSize = scraperBatchSize || 50;
    const scraperTargets = resolveScraperTargets();
    const effectiveScraperBatchSize = batchSize;

    if (Array.isArray(scraperTargets) && scraperTargets.length > 0) {
      logger.info('Running company scrapers before import sources');
      logger.info(`Scraper order: ${scraperTargets.join(', ')}`);

      const scraperSummary = {
        batchCount: 0,
        totalSavedRawJobs: 0,
        totalAiLoaded: 0,
        totalAiCompleted: 0,
        totalAiFailed: 0,
        totalDuplicateJobsSkipped: 0,
      };

      for (const target of scraperTargets) {
        const companyStartTime = Date.now();
        const timingStats = {
          startedAt: new Date(companyStartTime).toISOString(),
          pagesFetched: 0,
          listingJobsFetched: 0,
          detailJobsFetched: 0,
          recentJobs: 0,
          duplicates: 0,
          newJobsSaved: 0,
          stopReason: 'completed',
          durationMs: 0,
        };

        logger.info(`\n${'═'.repeat(70)}`);
        logger.info(`SCRAPER TARGET: ${target}`);
        logger.info(`${'═'.repeat(70)}`);

        const timeoutMs = Number(companyScraperTimeoutMs) || 120000;
        const companyDeadline = Date.now() + timeoutMs;

        try {
          let scrapedJobs = [];
          const controller = new AbortController();
          const companyTimer = setTimeout(() => {
            timingStats.stopReason = 'timeout';
            logger.warn(`Company scraper timeout after ${timeoutMs}ms for ${target}`);
            controller.abort();
          }, timeoutMs);

          try {
            const result = await Promise.race([
              runScrapers([target], { signal: controller.signal }),
              new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error(`Company scraper timed out after ${timeoutMs}ms`)), { once: true });
              }),
            ]);
            scrapedJobs = Array.isArray(result) ? result : [];
          } finally {
            clearTimeout(companyTimer);
          }

          const uniqueScrapedJobs = deduplicateScrapedJobs(scrapedJobs);
          timingStats.pagesFetched = 1;
          timingStats.listingJobsFetched = uniqueScrapedJobs.length;
          timingStats.recentJobs = uniqueScrapedJobs.length;

          logger.info(`  Scraped & Deduplicated: ${uniqueScrapedJobs.length} unique jobs`);

          if (uniqueScrapedJobs.length === 0) {
            logger.info(`  ⊘ No jobs found for ${target}`);
            logCompanyTiming(target, { ...timingStats, durationMs: Date.now() - companyStartTime });
            continue;
          }

          const { uniqueJobs, duplicateCount } = await deduplicateJobs(uniqueScrapedJobs);
          timingStats.duplicates = duplicateCount;

          if (duplicateCount > 0) {
            logger.info(`  Duplicates skipped: ${duplicateCount}`);
          }

          if (uniqueJobs.length === 0) {
            logger.info(`  ⊘ No new jobs to process for ${target}`);
            logCompanyTiming(target, { ...timingStats, durationMs: Date.now() - companyStartTime });
            continue;
          }

          const result = await saveJobs(uniqueJobs);
          if (result.error) {
            throw result.error;
          }

          const stats = result.stats || {};
          timingStats.newJobsSaved = stats.inserted || 0;
          const rawJobIds = Array.isArray(result.data)
            ? result.data.map((row) => row && row.id).filter(Boolean)
            : [];

          scraperSummary.totalSavedRawJobs += rawJobIds.length;
          scraperSummary.batchCount += 1;

          if (rawJobIds.length > 0) {
            logger.info(`    Saved raw jobs: ${rawJobIds.length}`);
          }

          logger.info(`    Prepared: ${stats.prepared || 0}`);
          logger.info(`    New Saved: ${stats.inserted || 0}`);
          logger.info(`    Already Processed: ${stats.skippedDuplicates || 0}`);
          logger.info(`    Updated: ${stats.updated || 0}`);

          logCompanyTiming(target, { ...timingStats, durationMs: Date.now() - companyStartTime, stopReason: timingStats.stopReason || 'completed' });
        } catch (error) {
          if (error && /timed out|timeout/i.test(error.message)) {
            timingStats.stopReason = 'timeout';
          } else {
            timingStats.stopReason = error?.message || 'error';
          }
          logger.error(`Scraper ${target} failed; continuing to next company: ${error.message}`);
          logCompanyTiming(target, { ...timingStats, durationMs: Date.now() - companyStartTime });
          continue;
        }
      }
    } else {
      logger.warn('No registered company scraper targets to run');
    }

    const importSources = [
      ...(importHclJobs ? [{ name: 'HCLTech', run: importHclJobs }] : []),
      ...(importTcsJobs ? [{ name: 'TCS', run: importTcsJobs }] : []),
    ];

    const importSummary = {
      batchCount: 0,
      totalSavedRawJobs: 0,
      totalAiLoaded: 0,
      totalAiCompleted: 0,
      totalAiFailed: 0,
      totalDuplicateJobsSkipped: 0,
    };

    for (const source of importSources) {
      let stats = null;
      logger.info(`\n${'═'.repeat(70)}`);
      logger.info(`IMPORT SOURCE: ${source.name}`);
      logger.info(`${'═'.repeat(70)}`);

      try {
        stats = await source.run();
        logger.info(
          `  Fetched: ${stats?.fetched || 0}, Inserted: ${stats?.inserted || stats?.total_inserted || 0}, Skipped: ${stats?.skipped || stats?.total_skipped || 0}, Failed: ${stats?.failed || stats?.total_failed || 0}`
        );
      } catch (error) {
        logger.error(`  ✗ ${source.name} import failed: ${error.message}`);
        stats = {};
      }

      const jobs = Array.isArray(stats.jobs) ? stats.jobs : [];
      if (jobs.length === 0) {
        logger.info(`  ⊘ No jobs to save`);
        continue;
      }

      logger.info(`  Jobs to process: ${jobs.length}`);

      for (let batchStart = 0; batchStart < jobs.length; batchStart += batchSize) {
        const batchJobs = jobs.slice(batchStart, batchStart + batchSize);
        importSummary.batchCount += 1;
        const batchNumber = importSummary.batchCount;

        logger.info(`\n  BATCH ${batchNumber}: ${batchJobs.length} job(s)`);
        const result = await saveJobs(batchJobs);
        if (result.error) {
          logger.error(`    ✗ Save failed: ${result.error.message}`);
          continue;
        }

        const batchStats = result.stats || {};
        logger.info(`    Prepared: ${batchStats.prepared || 0}`);
        logger.info(`    New Saved: ${batchStats.inserted || 0}`);
        logger.info(`    Already Processed: ${batchStats.skippedDuplicates || 0}`);
        logger.info(`    Updated: ${batchStats.updated || 0}`);

        const rawJobIds = Array.isArray(result.data)
          ? result.data.map((row) => row && row.id).filter(Boolean)
          : [];

        importSummary.totalSavedRawJobs += rawJobIds.length;
      }
    }

    logger.info('Import sources completed');
    logger.info(`Import source summary: batches=${importSummary.batchCount}, saved=${importSummary.totalSavedRawJobs}`);

    const durationMs = Date.now() - pipelineStartedAt;
    logger.info(`CYCLE_COMPLETED cycle=${currentCycleNumber} timestamp=${new Date().toISOString()} duration=${durationMs}ms`);
    logger.info('Job pipeline completed');
    logger.info(`Import batches processed: ${importSummary.batchCount}`);
    logger.info(`Total saved raw jobs: ${importSummary.totalSavedRawJobs}`);
    logger.info(`Pipeline duration ms: ${durationMs}`);
  } catch (error) {
    logger.error(`Scheduled pipeline error: ${error.message}`);
  } finally {
    pipelineRunning = false;
  }
}

function scheduleJobs() {
  JOB_SCHEDULES.forEach((cronExpression) => {
    cron.schedule(cronExpression, () => {
      runJobPipeline();
    });
    logger.info(`Scheduled job pipeline for cron expression: ${cronExpression}`);
  });

  logger.info(`Continuous pipeline loop enabled; repeating every ${CONTINUOUS_PIPELINE_INTERVAL_MS}ms after cycle completion`);
  const aiWorkerIntervalMs = Number(process.env.AI_WORKER_INTERVAL_MS || 60000) || 60000;
  const aiWorkerBatchSize = Number(process.env.AI_WORKER_BATCH_SIZE || 5) || 5;
  if (process.env.ENABLE_AI_WORKER !== 'false') {
    scheduleAiWorker({ batchSize: aiWorkerBatchSize, intervalMs: aiWorkerIntervalMs });
    logger.info(`AI worker schedule enabled; batchSize=${aiWorkerBatchSize}, interval=${aiWorkerIntervalMs}ms`);
  } else {
    logger.info('AI worker schedule disabled by ENABLE_AI_WORKER=false');
  }

  const continueLoop = async () => {
    await runJobPipeline();
    logger.info(`NEXT_CYCLE_SCHEDULED afterCycle=${cycleNumber} delay=${CONTINUOUS_PIPELINE_INTERVAL_MS}ms`);
    setTimeout(() => {
      logger.info(`NEXT_CYCLE_STARTED afterCycle=${cycleNumber}`);
      continueLoop().catch((error) => logger.error(`Continuous pipeline loop failed: ${error.message}`));
    }, CONTINUOUS_PIPELINE_INTERVAL_MS);
  };
  continueLoop().catch((error) => logger.error(`Continuous pipeline loop failed: ${error.message}`));
}

function scheduleAiWorker({
  batchSize = 5,
  intervalMs = 60000,
  worker = runAiWorker,
  loggerInstance = logger,
  setTimeoutFn = setTimeout,
} = {}) {
  let running = false;
  let stopped = false;
  let timer = null;

  const runScheduledAiWorker = async () => {
    if (stopped) return;
    if (running) {
      loggerInstance.warn('AI worker cycle already running; skipping overlapping trigger');
      return;
    }

    running = true;
    try {
      await worker({ batchSize });
    } catch (error) {
      loggerInstance.error(`Scheduled AI worker failed: ${error.message}`);
    } finally {
      running = false;
      if (!stopped) {
        timer = setTimeoutFn(() => {
          runScheduledAiWorker().catch((error) => loggerInstance.error(`Scheduled AI worker loop failed: ${error.message}`));
        }, intervalMs);
      }
    }
  };

  runScheduledAiWorker().catch((error) => loggerInstance.error(`Scheduled AI worker loop failed: ${error.message}`));

  return {
    trigger: runScheduledAiWorker,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = {
  runJobPipeline,
  scheduleJobs,
  scheduleAiWorker,
  resolveScraperTargets,
};
