'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { runJobPipeline } = require('./scheduler/cron');
const { closeBrowser } = require('./scrapers/browser');

async function main({
  runPipeline = runJobPipeline,
  closeBrowserFn = closeBrowser,
} = {}) {
  const startedAt = process.hrtime.bigint();
  let exitCode = 0;

  console.log('SCRAPE_ONCE_STARTED');
  try {
    await runPipeline({ throwOnError: true, awaitTimedOutScrapers: true });
  } catch (error) {
    console.error('SCRAPE_ONCE_FAILED');
    console.error(error && error.stack ? error.stack : error);
    exitCode = 1;
  }

  try {
    await closeBrowserFn();
  } catch (error) {
    console.error('Browser cleanup failed');
    console.error(error && error.stack ? error.stack : error);
    exitCode = 1;
  }

  const runtimeMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  console.log('SCRAPE_ONCE_COMPLETED');
  console.log(`TOTAL_RUNTIME_MS=${runtimeMs}`);
  console.log(`TOTAL_RUNTIME_SECONDS=${(runtimeMs / 1000).toFixed(3)}`);
  process.exitCode = exitCode;
  return exitCode;
}

if (require.main === module) {
  main();
}

module.exports = { main };
