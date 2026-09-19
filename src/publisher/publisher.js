'use strict';

const logger = require('../utils/logger');
const supabaseClient = require('../database/supabaseClient');

const SYSTEM_USER_ID = '0443dc8c-136c-4a83-b484-28435d9025b0';
const DEFAULT_JOB_TYPE = 'Full-Time';
const DEFAULT_WORK_MODE = 'Onsite';

function normalizeJobType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return DEFAULT_JOB_TYPE;
  }
  if (text.includes('part')) {
    return 'Part-Time';
  }
  if (text.includes('intern')) {
    return 'Internship';
  }
  if (text.includes('contract')) {
    return 'Contract';
  }
  if (text.includes('freelance')) {
    return 'Freelance';
  }
  return 'Full-Time';
}

function normalizeWorkMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return 'Unknown';
  }
  if (text.includes('unknown')) {
    return 'Unknown';
  }
  if (text.includes('remote')) {
    return 'Remote';
  }
  if (text.includes('hybrid')) {
    return 'Hybrid';
  }
  return 'Onsite';
}

function parseSalary(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { salaryMin: null, salaryMax: null };
  }

  const match = text.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) {
    return { salaryMin: null, salaryMax: null };
  }

  const min = Number(match[1]);
  const max = match[2] != null ? Number(match[2]) : min;

  return {
    salaryMin: Number.isFinite(min) && min > 0 ? min : null,
    salaryMax: Number.isFinite(max) && max > 0 ? max : null,
  };
}

function normalizeExperience(value) {
  const text = String(value || '').trim();
  return text || 'Not Specified';
}

function normalizeSkills(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => String(entry || '').trim());
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    return parts;
  }
  return [];
}

function buildJobPayload(processedJob, company) {
  const { salaryMin, salaryMax } = parseSalary(processedJob.salary);

  return {
    title: processedJob.title || null,
    company_name: company?.name || null,
    company_logo_url: company?.logo_url || null,
    location: processedJob.location || 'Location Not Specified',
    job_type: normalizeJobType(processedJob.employment_type),
    work_mode: normalizeWorkMode(processedJob.work_mode),
    salary_min: salaryMin,
    salary_max: salaryMax,
    experience: normalizeExperience(processedJob.experience),
    education: processedJob.education || 'Not Specified',
    description: processedJob.description || processedJob.summary || 'Job description will be shared during the interview process.',
    category: processedJob.category || null,
    skills: normalizeSkills(processedJob.skills),
    application_link: processedJob.apply_url || null,
    application_deadline: processedJob.expiry_date || null,
    posted_by: SYSTEM_USER_ID,
    featured: false,
    status: 'published',
    applications_count: 0,
    currency: processedJob.currency || null,
    positions_available: 1,
    screening_questions: [],
  };
}

async function publishPendingJobs(options = {}) {
  const loggerInstance = options.logger || logger;
  const supabase = options.supabase || supabaseClient;
  const rawJobIds = Array.isArray(options.rawJobIds) ? options.rawJobIds.filter(Boolean) : [];

  loggerInstance.info('Publisher Started');
  if (rawJobIds.length) {
    loggerInstance.info(`Publisher rawJobIds filter count: ${rawJobIds.length}`);
  }

  try {
    let query = supabase
      .from('processed_jobs')
      .select('*')
      .eq('published', false)
      .eq('ai_processed', true)
      .neq('status', 'Failed')
      .eq('is_active', true);

    if (rawJobIds.length) {
      query = query.in('raw_job_id', rawJobIds);
    }

    const { data: pendingRows, error: pendingError } = await query;

    if (pendingError) {
      throw pendingError;
    }

    const processedJobs = Array.isArray(pendingRows) ? pendingRows : [];
    loggerInstance.info(`Found ${processedJobs.length} Jobs`);
    loggerInstance.info('Publishing...');

    let publishedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const processedJob of processedJobs) {
      try {
        const { data: companyRow, error: companyError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', processedJob.company_id)
          .maybeSingle();

        if (companyError) {
          loggerInstance.warn(`Company lookup failed for processed job ${processedJob.id}: ${companyError.message}`);
        }

        if (!processedJob?.title || !processedJob?.apply_url || !processedJob?.company_id) {
          loggerInstance.warn(`Skipped invalid processed job ${processedJob.id}: missing title, apply_url, or company_id`);
          await supabase
            .from('processed_jobs')
            .update({
              published: true,
              published_at: new Date().toISOString(),
              processing_error: 'Skipped invalid processed job payload',
            })
            .eq('id', processedJob.id);
          skippedCount += 1;
          continue;
        }

        const existingJobCheck = await supabase
          .from('jobs')
          .select('id')
          .eq('application_link', processedJob.apply_url)
          .maybeSingle();

        if (existingJobCheck.error) {
          throw existingJobCheck.error;
        }

        if (existingJobCheck.data) {
          loggerInstance.info(`Skipped Duplicate ${processedJob.title || 'Untitled Job'}`);
          skippedCount += 1;
          await supabase
            .from('processed_jobs')
            .update({
              published: true,
              published_at: new Date().toISOString(),
            })
            .eq('id', processedJob.id);
          continue;
        }

        const payload = buildJobPayload(processedJob, companyRow || null);
        const { data: insertedRow, error: insertError } = await supabase
          .from('jobs')
          .insert(payload)
          .select()
          .single();

        if (insertError) {
          throw insertError;
        }

        loggerInstance.info(`Published ${processedJob.title || 'Untitled Job'}`);
        publishedCount += 1;

        try {
          await supabase
            .from('processed_job_keys')
            .insert([
              {
                apply_url: processedJob.apply_url,
                source: processedJob.source || null,
                company_name: companyRow?.name || processedJob.company_name || null,
                posted_date: processedJob.posted_date || null,
              },
            ], { onConflict: 'apply_url', ignoreDuplicates: true });
        } catch (keyError) {
          loggerInstance.warn(`Failed to record processed_job_keys entry for ${processedJob.apply_url}: ${keyError.message}`);
        }

        await supabase
          .from('processed_jobs')
          .update({
            published: true,
            published_at: new Date().toISOString(),
            published_job_id: insertedRow.id,
          })
          .eq('id', processedJob.id);
      } catch (error) {
        failedCount += 1;
        loggerInstance.error(`Failed to publish processed job ${processedJob.id}: ${error.message}`);
        await supabase
          .from('processed_jobs')
          .update({
            retry_count: (processedJob.retry_count || 0) + 1,
            processing_error: error.message,
          })
          .eq('id', processedJob.id);
      }
    }

    loggerInstance.info('Publisher Finished');
    loggerInstance.info(`Success: ${publishedCount}`);
    loggerInstance.info(`Skipped: ${skippedCount}`);
    loggerInstance.info(`Failed: ${failedCount}`);

    return { publishedCount, skippedCount, failedCount };
  } catch (error) {
    loggerInstance.error(`Publisher failed: ${error.message}`);
    return { publishedCount: 0, skippedCount: 0, failedCount: 0, error: error.message };
  }
}

module.exports = {
  publishPendingJobs,
  buildJobPayload,
  normalizeJobType,
  normalizeWorkMode,
  parseSalary,
  normalizeExperience,
  normalizeSkills,
  SYSTEM_USER_ID,
};
