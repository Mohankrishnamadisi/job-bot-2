'use strict';

const supabase = require('../src/database/supabaseClient');
const logger = require('../src/utils/logger');

const BATCH_SIZE = 500;

async function fetchAllRows(tableName, select = '*') {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(select)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const chunk = Array.isArray(data) ? data : [];
    if (!chunk.length) {
      break;
    }

    rows.push(...chunk);
    if (chunk.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

async function main() {
  try {
    const rawJobs = await fetchAllRows('raw_jobs', 'id');
    const queueRows = await fetchAllRows('ai_queue', 'raw_job_id');

    const existingQueueRawJobIds = new Set(
      (Array.isArray(queueRows) ? queueRows : [])
        .map((row) => row && row.raw_job_id)
        .filter((value) => value != null && value !== '')
    );

    const missingRawJobs = (Array.isArray(rawJobs) ? rawJobs : []).filter(
      (row) => row && row.id != null && !existingQueueRawJobIds.has(row.id)
    );

    const rawJobsCount = (Array.isArray(rawJobs) ? rawJobs : []).length;
    const queueBeforeCount = (Array.isArray(queueRows) ? queueRows : []).length;

    logger.info(`Loaded raw jobs : ${rawJobsCount}`);
    logger.info(`Already queued : ${queueBeforeCount}`);

    let inserted = 0;
    let skipped = 0;
    let batchNumber = 0;

    for (let index = 0; index < missingRawJobs.length; index += BATCH_SIZE) {
      const batch = missingRawJobs.slice(index, index + BATCH_SIZE);
      batchNumber += 1;

      if (!batch.length) {
        continue;
      }

      const payload = batch.map((row) => ({
        raw_job_id: row.id,
        status: 'Pending',
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      try {
        const { error } = await supabase.from('ai_queue').insert(payload);
        if (error) {
          logger.error(`Backfill batch ${batchNumber} failed: ${error.message}`);
          skipped += batch.length;
          continue;
        }

        inserted += batch.length;
        logger.info(`Inserted : ${inserted}`);
      } catch (error) {
        logger.error(`Backfill batch ${batchNumber} failed: ${error.message}`);
        skipped += batch.length;
      }
    }

    logger.info('Finished.');
    logger.info(`Raw Jobs : ${rawJobsCount}`);
    logger.info(`Queue Before : ${queueBeforeCount}`);
    logger.info(`Queue After : ${queueBeforeCount + inserted}`);
    logger.info(`Inserted : ${inserted}`);
    logger.info(`Skipped : ${skipped}`);
  } catch (error) {
    logger.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main().finally(() => {
  process.exit();
});
