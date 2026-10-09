'use strict';

const path = require('path');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const { scrapeWindowMinutes } = require('./config/env');
const { runJobPipeline } = require('./scheduler/cron');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function resolveWindowMinutes() {
  const parsedValue = Number(process.env.SCRAPE_WINDOW_MINUTES);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }
  return Number(scrapeWindowMinutes) || 65;
}

async function main() {
  const windowMinutes = resolveWindowMinutes();
  const windowMs = windowMinutes * 60 * 1000;
  const startTime = Date.now();
  const deadline = startTime + windowMs;
  let cycle = 0;

  logger.info(
    `TIMED_SCRAPE_WINDOW_STARTED minutes=${windowMinutes} windowMs=${windowMs} start=${new Date(startTime).toISOString()} deadline=${new Date(deadline).toISOString()}`
  );

  while (Date.now() < deadline) {
    cycle += 1;
    const cycleStart = Date.now();

    logger.info(`TIMED_SCRAPE_CYCLE_STARTED cycle=${cycle} start=${new Date(cycleStart).toISOString()}`);

    try {
      await runJobPipeline();
      logger.info(`TIMED_SCRAPE_CYCLE_COMPLETED cycle=${cycle} durationMs=${Date.now() - cycleStart}`);
    } catch (error) {
      logger.error(`TIMED_SCRAPE_CYCLE_FAILED cycle=${cycle} error=${error && error.message ? error.message : error}`);
    }
  }

  const endTime = Date.now();
  const totalElapsedMs = endTime - startTime;
  logger.info(
    `TIMED_SCRAPE_WINDOW_COMPLETED totalElapsedMs=${totalElapsedMs} totalCycles=${cycle} start=${new Date(startTime).toISOString()} end=${new Date(endTime).toISOString()}`
  );
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`Timed pipeline failed: ${error && error.stack ? error.stack : error}`);
      process.exit(1);
    });
}

module.exports = { main, resolveWindowMinutes };
