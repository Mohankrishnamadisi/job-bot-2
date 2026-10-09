'use strict';

const db2Client = require('../database/supabaseClient');
const db1Client = require('../database/db1Client');
const logger = require('../utils/logger');

const BATCH_SIZE = 100;
const JOB_FIELDS = [
  'title',
  'company_name',
  'company_logo_url',
  'location',
  'job_type',
  'salary_min',
  'salary_max',
  'experience',
  'description',
  'skills',
  'application_link',
  'posted_by',
  'featured',
  'status',
  'category',
  'education',
  'application_deadline',
  'currency',
  'work_mode',
  'positions_available',
  'screening_questions',
].join(',');

function identityKey(postedBy, applicationLink) {
  return `${postedBy}\u0000${applicationLink}`;
}

function buildDb1JobPayload(job) {
  return Object.fromEntries(
    JOB_FIELDS.split(',').map((field) => [field, job[field] ?? null])
  );
}

async function loadDb2Jobs(supabase, batchSize) {
  const jobs = [];

  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_FIELDS)
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    jobs.push(...batch);
    if (batch.length < batchSize) break;
  }

  return jobs;
}

async function loadExistingDb1Jobs(supabase, jobs, batchSize) {
  const existingJobs = [];
  const groups = new Map();

  for (const job of jobs) {
    if (!job.posted_by || !job.application_link) continue;
    const links = groups.get(job.posted_by) || new Set();
    links.add(job.application_link);
    groups.set(job.posted_by, links);
  }

  for (const [postedBy, links] of groups) {
    const linkList = Array.from(links);
    for (let offset = 0; offset < linkList.length; offset += batchSize) {
      const { data, error } = await supabase
        .from('jobs')
        .select('id,posted_by,application_link')
        .eq('posted_by', postedBy)
        .in('application_link', linkList.slice(offset, offset + batchSize));

      if (error) throw error;
      existingJobs.push(...(Array.isArray(data) ? data : []));
    }
  }

  return existingJobs;
}

async function insertJobsInBatches(supabase, jobs, batchSize, loggerInstance, stats) {
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const batch = jobs.slice(offset, offset + batchSize);
    let batchError;
    try {
      ({ error: batchError } = await supabase.from('jobs').insert(batch));
    } catch (error) {
      batchError = error;
    }

    if (!batchError) {
      stats.insertedCount += batch.length;
      continue;
    }

    for (const job of batch) {
      let rowError;
      try {
        ({ error: rowError } = await supabase.from('jobs').insert(job));
      } catch (error) {
        rowError = error;
      }
      if (rowError) {
        stats.errorCount += 1;
        loggerInstance.error(`[SYNC] Failed to insert job ${job.application_link}: ${rowError.message}`);
      } else {
        stats.insertedCount += 1;
      }
    }
  }
}

async function updateJobs(supabase, jobs, batchSize, loggerInstance, stats) {
  for (let offset = 0; offset < jobs.length; offset += batchSize) {
    const batch = jobs.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async ({ id, payload, applicationLink }) => {
      try {
        const { error } = await supabase.from('jobs').update(payload).eq('id', id);
        return { id, applicationLink, error };
      } catch (error) {
        return { id, applicationLink, error };
      }
    }));

    for (const result of results) {
      if (result.error) {
        stats.errorCount += 1;
        loggerInstance.error(`[SYNC] Failed to update job ${result.applicationLink}: ${result.error.message || result.error}`);
      } else {
        stats.updatedCount += 1;
      }
    }
  }
}

async function syncJobsToDb1(options = {}) {
  const db2 = options.db2 || db2Client;
  const db1 = options.db1 || db1Client;
  const loggerInstance = options.logger || logger;
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0
    ? options.batchSize
    : BATCH_SIZE;
  const stats = { foundCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0 };

  loggerInstance.info('[SYNC] DB2 -> DB1 started');
  try {
    const db2Jobs = await loadDb2Jobs(db2, batchSize);
    stats.foundCount = db2Jobs.length;
    loggerInstance.info(`[SYNC] DB2 jobs found: ${stats.foundCount}`);

    const jobsByIdentity = new Map();
    for (const job of db2Jobs) {
      if (!job.application_link || !job.posted_by) {
        loggerInstance.warn(`[SYNC] Skipping DB2 job without application_link or posted_by: ${job.title || job.id || 'unknown'}`);
        continue;
      }
      jobsByIdentity.set(identityKey(job.posted_by, job.application_link), job);
    }
    stats.skippedCount = db2Jobs.length - jobsByIdentity.size;

    const validJobs = Array.from(jobsByIdentity.values());
    const existingJobs = await loadExistingDb1Jobs(db1, validJobs, batchSize);
    const existingByIdentity = new Map();
    for (const job of existingJobs) {
      const key = identityKey(job.posted_by, job.application_link);
      if (!existingByIdentity.has(key)) existingByIdentity.set(key, job);
    }

    const inserts = [];
    const updates = [];
    for (const job of validJobs) {
      const existing = existingByIdentity.get(identityKey(job.posted_by, job.application_link));
      const payload = buildDb1JobPayload(job);
      if (existing) {
        updates.push({ id: existing.id, payload, applicationLink: job.application_link });
      } else {
        inserts.push(payload);
      }
    }

    await insertJobsInBatches(db1, inserts, batchSize, loggerInstance, stats);
    await updateJobs(db1, updates, batchSize, loggerInstance, stats);
  } catch (error) {
    stats.errorCount += 1;
    loggerInstance.error(`[SYNC] Sync failed: ${error.message}`);
    throw error;
  } finally {
    loggerInstance.info(`[SYNC] New jobs inserted: ${stats.insertedCount}`);
    loggerInstance.info(`[SYNC] Existing jobs updated: ${stats.updatedCount}`);
    loggerInstance.info(`[SYNC] Jobs skipped: ${stats.skippedCount}`);
    loggerInstance.info(`[SYNC] Sync errors: ${stats.errorCount}`);
    loggerInstance.info('[SYNC] DB2 -> DB1 completed');
  }

  return stats;
}

module.exports = { syncJobsToDb1, buildDb1JobPayload };
