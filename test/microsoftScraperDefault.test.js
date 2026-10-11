const test = require('node:test');
const assert = require('node:assert/strict');

const microsoftModule = require('../src/scrapers/microsoft');
const indexPath = require.resolve('../src/scrapers/index');
let capturedArgs = null;
const original = microsoftModule.scrapeMicrosoftJobs;

microsoftModule.scrapeMicrosoftJobs = (...args) => {
  capturedArgs = args;
  return Promise.resolve({ result: [{ title: 'Job 1' }, { title: 'Job 2' }] });
};

delete require.cache[indexPath];
const { runScrapers } = require('../src/scrapers/index');

test('microsoft scraper does not default to fullSync in the app registry', async () => {
  const stats = { fetched: 0, failed: 0 };
  const jobs = await runScrapers(['microsoft'], { stats });
  assert.equal(jobs.length, 2);
  assert.equal(stats.fetched, 2);
  assert.equal(stats.failed, 0);
  assert.deepEqual(capturedArgs, ['', '', false]);
  microsoftModule.scrapeMicrosoftJobs = original;
});
