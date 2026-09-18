'use strict';

const supabase = require('./supabaseClient');
const logger = require('../utils/logger');
const { getCompanyByName, ensureCompany, SUPPORTED_COMPANY_NAMES } = require('./companyRepository');
const { getConfiguredLookbackDays } = require('../utils/recentJobPolicy');

const REQUIRED_JOB_COLUMNS = ['company_id', 'title', 'apply_url'];
const DATE_FIELD_CANDIDATES = ['posted_date', 'postedDate', 'published_at', 'publishedAt', 'created_at', 'createdAt', 'date'];
let backlogQueueInitialized = false;

function normalizeJobPayload(job) {
  if (!job || typeof job !== 'object') return null;

  return {
    company_id: job.company_id || null,
    title: job.title || null,
    location: job.location || null,
    experience: job.experience || null,
    employment_type: job.employment_type || null,
    work_mode: job.work_mode || null,
    salary: job.salary || null,
    description: job.description || null,
    summary: job.summary || null,
    skills: job.skills || null,
    apply_url: job.apply_url || null,
    source: job.source || 'ATS',
    posted_date: job.posted_date || job.postedDate || null,
    expiry_date: job.expiryDate || job.expiry_date || null,
    status: job.status || 'active',
    is_active: job.is_active !== false,
    external_job_id: job.external_job_id || job.positionId || job.position_id || null,
  };
}

function extractPostingDate(job) {
  if (!job || typeof job !== 'object') {
    return null;
  }

  for (const field of DATE_FIELD_CANDIDATES) {
    const value = job[field];
    if (value == null || String(value).trim() === '') {
      continue;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function isJobWithinConfiguredLookback(job, days = getConfiguredLookbackDays()) {
  const postingDate = extractPostingDate(job);
  if (!postingDate) {
    return true;
  }

  const cutoffMs = getConfiguredLookbackDays(days) * 24 * 60 * 60 * 1000;
  const ageInMs = Date.now() - postingDate.getTime();
  return ageInMs >= 0 && ageInMs <= cutoffMs;
}

async function resolveCompanyIdForJob(job, repository = { getCompanyByName, ensureCompany, SUPPORTED_COMPANY_NAMES }) {
  if (!job || typeof job !== 'object') {
    return null;
  }

  if (job.company_id) {
    return job.company_id;
  }

  const allowedCompanyNames = Array.isArray(SUPPORTED_COMPANY_NAMES)
    ? SUPPORTED_COMPANY_NAMES
    : Array.isArray(repository?.SUPPORTED_COMPANY_NAMES)
      ? repository.SUPPORTED_COMPANY_NAMES
      : [];

  const rawCompanyName = String(job.company || job.company_name || job.source || '').trim();
  const normalizedRawCompanyName = rawCompanyName.toLowerCase();
  const companyName = allowedCompanyNames.find((name) => name.toLowerCase() === normalizedRawCompanyName)
    || allowedCompanyNames.find((name) => normalizedRawCompanyName.includes(name.toLowerCase()))
    || rawCompanyName;

  if (!companyName) {
    logger.warn(`Company resolution skipped for unapproved value: ${rawCompanyName || 'empty'}`);
    return null;
  }

  const existingCompany = await repository.getCompanyByName(companyName);
  if (existingCompany?.id) {
    logger.info(`Company Found: ${companyName} -> ${existingCompany.id}`);
    return existingCompany.id;
  }

  const createdCompany = await repository.ensureCompany({
    name: companyName,
    enabled: true,
    career_url: null,
  });

  if (createdCompany?.id) {
    logger.info(`Company Created: ${companyName} -> ${createdCompany.id}`);
    return createdCompany.id;
  }

  logger.warn(`Company resolution failed for ${companyName}`);
  return null;
}

async function enrichJobsForPersistence(jobs) {
  // NOTE: AI enrichment has been removed from the persistence layer.
  // Jobs should be saved as raw, and enrichment should happen ONLY
  // through the ai_queue worker (see aiWorker.js).
  // This prevents unnecessary API calls and quota exhaustion.
  return Array.isArray(jobs) ? jobs : [];
}

async function prepareJobsForInsert(jobs) {
  const preparedJobs = [];
  const inputJobs = Array.isArray(jobs) ? jobs : [];
  const enrichedJobs = await enrichJobsForPersistence(inputJobs);

  // fetch and cache array-typed columns for the `raw_jobs` table
  if (!prepareJobsForInsert._arrayColumns) {
    try {
      const { data: cols, error } = await supabase
        .from('information_schema.columns')
        .select('column_name,data_type,udt_name')
        .eq('table_name', 'raw_jobs')
        .eq('table_schema', 'public');

      if (!error && Array.isArray(cols)) {
        const arrCols = cols
          .filter((c) => c && (String(c.data_type).toUpperCase() === 'ARRAY' || (c.udt_name && String(c.udt_name).startsWith('_'))))
          .map((c) => c.column_name);
        prepareJobsForInsert._arrayColumns = new Set(arrCols || []);
      } else {
        // fallback: common array-like columns used by importers
        prepareJobsForInsert._arrayColumns = new Set(['skills']);
        logger.warn('Could not inspect information_schema.columns for raw_jobs; defaulting array columns to [skills]');
      }
    } catch (err) {
      prepareJobsForInsert._arrayColumns = new Set(['skills']);
      logger.warn('Error reading raw_jobs table schema; defaulting array columns to [skills]');
    }
  }

  for (const job of enrichedJobs) {
    const normalizedJob = normalizeJobPayload(job);
    if (!normalizedJob) {
      continue;
    }

    if (!isJobWithinConfiguredLookback(job)) {
      logger.info(`Skipping raw job older than ${getConfiguredLookbackDays()} days or with unparseable posting date`);
      continue;
    }

    if (!normalizedJob.company_id) {
      const companyId = await resolveCompanyIdForJob(job);
      if (companyId) {
        normalizedJob.company_id = companyId;
      } else {
        continue;
      }
    }

    const missingColumns = REQUIRED_JOB_COLUMNS.filter((column) => {
      const value = normalizedJob[column];
      return value == null || (typeof value === 'string' && value.trim() === '');
    });

    if (missingColumns.length > 0) {
      continue;
    }

    // Normalize any array-typed columns according to DB schema rules
    try {
      for (const col of Array.from(prepareJobsForInsert._arrayColumns || [])) {
        if (!Object.prototype.hasOwnProperty.call(normalizedJob, col)) continue;
        const v = normalizedJob[col];
        if (v == null) {
          normalizedJob[col] = null;
          continue;
        }
        if (Array.isArray(v)) {
          // keep as-is
          continue;
        }
        if (typeof v === 'string') {
          const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
          if (parts.length === 0) {
            normalizedJob[col] = null;
          } else if (parts.length === 1) {
            normalizedJob[col] = [parts[0]];
          } else {
            normalizedJob[col] = parts;
          }
          continue;
        }
        // non-string, non-array values -> wrap into array
        normalizedJob[col] = [String(v)];
      }
    } catch (err) {
      logger.warn('Array column normalization failed', err && err.message ? err.message : String(err));
    }

    preparedJobs.push(normalizedJob);
  }

  return preparedJobs;
}

function buildAiQueuePayloadsForNewRawJobs(rawJobs, existingQueueRows = []) {
  const existingRawJobIds = new Set(
    (Array.isArray(existingQueueRows) ? existingQueueRows : [])
      .map((row) => row && row.raw_job_id)
      .filter((value) => value != null && value !== '')
  );

  return (Array.isArray(rawJobs) ? rawJobs : [])
    .map((job) => job && job.id != null ? job : null)
    .filter(Boolean)
    .filter((job) => !existingRawJobIds.has(job.id))
    .map((job) => ({
      raw_job_id: job.id,
      status: 'Pending',
      retry_count: 0,
    }));
}

async function ensureBacklogQueueEntries(options = {}) {
  const loggerInstance = options.logger || logger;
  const activeSupabase = options.supabase || supabase;

  if (backlogQueueInitialized) {
    return { inserted: 0, skipped: 0, alreadyInitialized: true };
  }

  try {
    const { data: rawJobs, error: rawJobsError } = await activeSupabase
      .from('raw_jobs')
      .select('id');

    if (rawJobsError) {
      throw rawJobsError;
    }

    const { data: queueRows, error: queueError } = await activeSupabase
      .from('ai_queue')
      .select('raw_job_id');

    if (queueError) {
      throw queueError;
    }

    const existingQueueRawJobIds = new Set(
      (Array.isArray(queueRows) ? queueRows : [])
        .map((row) => row && row.raw_job_id)
        .filter((value) => value != null && value !== '')
    );

    const missingRawJobs = (Array.isArray(rawJobs) ? rawJobs : [])
      .map((row) => row && row.id != null ? row.id : null)
      .filter((value) => value != null && value !== '')
      .filter((id) => !existingQueueRawJobIds.has(id));

    if (!missingRawJobs.length) {
      backlogQueueInitialized = true;
      loggerInstance.info('Backlog queue initialization skipped: all raw jobs already have queue entries');
      return { inserted: 0, skipped: 0, alreadyInitialized: true };
    }

    const payloads = [];
    const batchSize = 500;
    for (let index = 0; index < missingRawJobs.length; index += batchSize) {
      const batch = missingRawJobs.slice(index, index + batchSize);
      payloads.push(...batch.map((rawJobId) => ({
        raw_job_id: rawJobId,
        status: 'Pending',
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })));
    }

    if (payloads.length) {
      const { error: insertError } = await activeSupabase
        .from('ai_queue')
        .insert(payloads);

      if (insertError) {
        throw insertError;
      }
    }

    backlogQueueInitialized = true;
    loggerInstance.info(`Backlog queue initialization complete: inserted ${payloads.length} entries`);
    return { inserted: payloads.length, skipped: missingRawJobs.length - payloads.length, alreadyInitialized: false };
  } catch (error) {
    loggerInstance.error(`Backlog queue initialization failed: ${error.message}`);
    return { inserted: 0, skipped: 0, alreadyInitialized: false, error: error.message };
  }
}

async function insertJobs(jobs) {
  const preparedJobs = await prepareJobsForInsert(jobs);

  if (!preparedJobs.length) {
    return { data: [], error: null, stats: { fetched: Array.isArray(jobs) ? jobs.length : 0, prepared: 0, inserted: 0, skippedDuplicates: 0, failed: 0 } };
  }

  let preparedInsertedCount = 0;
  let preparedUpdatedCount = 0;
  let newInsertApplyUrls = [];

  try {
    const applyUrls = preparedJobs
      .map((job) => job.apply_url)
      .filter((url) => typeof url === 'string' && url.trim() !== '');
    const jobsEligibleForRawInsert = preparedJobs;

    if (applyUrls.length > 0) {
      const { data: existingRows, error: existingError } = await supabase
        .from('raw_jobs')
        .select('apply_url')
        .in('apply_url', jobsEligibleForRawInsert.map((job) => job.apply_url));

      if (!existingError && Array.isArray(existingRows)) {
        const existingApplyUrls = new Set(existingRows.map((row) => row?.apply_url).filter(Boolean));
        preparedUpdatedCount = jobsEligibleForRawInsert.filter((job) => existingApplyUrls.has(job.apply_url)).length;
        preparedInsertedCount = jobsEligibleForRawInsert.length - preparedUpdatedCount;
        newInsertApplyUrls = jobsEligibleForRawInsert
          .filter((job) => !existingApplyUrls.has(job.apply_url))
          .map((job) => job.apply_url)
          .filter((url) => typeof url === 'string' && url.trim() !== '');
      }
    }

    const { data, error } = await supabase
      .from('raw_jobs')
      .upsert(jobsEligibleForRawInsert, { onConflict: 'apply_url' })
      .select('id,apply_url');

    if (error) {
      logger.error(`Jobs insert failed: ${error.message}`);
      if (error.details) {
        logger.error(`Jobs insert details: ${error.details}`);
      }
      return {
        data: null,
        error,
        stats: {
          fetched: Array.isArray(jobs) ? jobs.length : 0,
          prepared: preparedJobs.length,
          inserted: preparedInsertedCount,
          updated: preparedUpdatedCount,
          skippedDuplicates: 0,
          failed: preparedJobs.length,
        },
      };
    }

    const insertedRows = Array.isArray(data) ? data : [];
    const insertedCount = preparedInsertedCount || insertedRows.length;
    const updatedCount = preparedUpdatedCount || Math.max(0, insertedRows.length - insertedCount);

    try {
      if (newInsertApplyUrls.length > 0) {
        const { data: newlyInsertedRawJobs, error: insertedRowsLookupError } = await supabase
          .from('raw_jobs')
          .select('id,apply_url')
          .in('apply_url', newInsertApplyUrls);

        if (!insertedRowsLookupError && Array.isArray(newlyInsertedRawJobs)) {
          const insertedRawJobIds = (newlyInsertedRawJobs || [])
            .map((row) => row && row.id)
            .filter((value) => value != null && value !== '');

          if (insertedRawJobIds.length > 0) {
            const { data: existingQueueRows, error: queueLookupError } = await supabase
              .from('ai_queue')
              .select('raw_job_id')
              .in('raw_job_id', insertedRawJobIds);

            if (!queueLookupError) {
              const queuePayloads = buildAiQueuePayloadsForNewRawJobs(
                newlyInsertedRawJobs || [],
                existingQueueRows || []
              ).map((payload) => ({
                ...payload,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }));

              if (queuePayloads.length > 0) {
                const { error: queueInsertError } = await supabase
                  .from('ai_queue')
                  .insert(queuePayloads);

                if (queueInsertError) {
                  logger.warn(`AI queue creation failed: ${queueInsertError.message}`);
                } else {
                  logger.info(`AI queue entries created: ${queuePayloads.length}`);
                }
              }
            } else {
              logger.warn(`AI queue lookup failed: ${queueLookupError.message}`);
            }
          }
        } else {
          logger.warn(`AI queue lookup failed: ${insertedRowsLookupError ? insertedRowsLookupError.message : 'Unable to load newly inserted raw jobs'}`);
        }
      }
    } catch (queueError) {
      logger.warn(`AI queue creation failed: ${queueError.message}`);
    }

    return {
      data: insertedRows,
      error: null,
      stats: {
        fetched: Array.isArray(jobs) ? jobs.length : 0,
        prepared: preparedJobs.length,
        inserted: insertedCount,
        updated: updatedCount,
          skippedDuplicates: 0,
        failed: 0,
      },
    };
  } catch (error) {
    logger.error(`Jobs insert failed: ${error.message}`);
    return {
      data: null,
      error,
      stats: {
        fetched: Array.isArray(jobs) ? jobs.length : 0,
        prepared: preparedJobs.length,
        inserted: preparedInsertedCount,
        updated: preparedUpdatedCount,
        skippedDuplicates: 0,
        failed: preparedJobs.length,
      },
    };
  }
}

async function upsertJobs(jobs) {
  const preparedJobs = await prepareJobsForInsert(jobs);
  return supabase.from('raw_jobs').upsert(preparedJobs);
}

async function deleteExpiredJobs(companyId) {
  return supabase.from('raw_jobs').delete().eq('company_id', companyId);
}

async function getJobsBySourceAndApplyUrls(source, applyUrls) {
  if (!Array.isArray(applyUrls) || applyUrls.length === 0) {
    return { data: [] };
  }

  const { data, error } = await supabase
    .from('raw_jobs')
    .select('*')
    .eq('source', source)
    .in('apply_url', applyUrls);

  return { data: data || [], error };
}

async function getAllJobsBySource(source) {
  const { data, error } = await supabase
    .from('raw_jobs')
    .select('*')
    .eq('source', source);

  return { data: data || [], error };
}

async function saveJobs(jobs) {
  const filteredJobs = (jobs || []).filter(Boolean);
  return insertJobs(filteredJobs);
}

async function updateJobs(jobs) {
  const preparedJobs = await prepareJobsForInsert(jobs);
  const { data, error } = await supabase.from('raw_jobs').upsert(preparedJobs);
  return { data, error };
}

async function markJobsInactive(jobIds) {
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from('raw_jobs')
    .update({ is_active: false })
    .in('id', jobIds);

  return { data: data || [], error };
}

module.exports = {
  normalizeJobPayload,
  extractPostingDate,
  isJobWithinConfiguredLookback,
  resolveCompanyIdForJob,
  enrichJobsForPersistence,
  prepareJobsForInsert,
  buildAiQueuePayloadsForNewRawJobs,
  ensureBacklogQueueEntries,
  insertJobs,
  upsertJobs,
  deleteExpiredJobs,
  getJobsBySourceAndApplyUrls,
  getAllJobsBySource,
  saveJobs,
  updateJobs,
  markJobsInactive,
};
