'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const { runJobPipeline } = require('./scheduler/cron');

async function main() {
  console.log('Pipeline Started');

  try {
    await runJobPipeline();
    console.log('Pipeline Finished');
    process.exit(0);
  } catch (error) {
    console.error('Pipeline Failed');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
