'use strict';

const { runAiWorker } = require('../src/workers/aiWorker');
const logger = require('../src/utils/logger');

async function main() {
  try {
    const rawJobId = process.argv[2];
    const options = rawJobId ? { debug: true, rawJobId } : {};
    const result = await runAiWorker(options);
    logger.info(`Jobs Loaded: ${result.jobsLoaded}`);
    logger.info(`Jobs Completed: ${result.jobsCompleted}`);
    logger.info(`Jobs Failed: ${result.jobsFailed}`);
    logger.info(`Processing Time: ${result.processingTimeMs}ms`);
  } catch (error) {
    logger.error(`Manual AI worker run failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main().finally(() => {
  process.exit();
});
