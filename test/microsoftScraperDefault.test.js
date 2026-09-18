const test = require('node:test');
const assert = require('node:assert/strict');

const microsoftModule = require('../src/scrapers/microsoft');
const indexPath = require.resolve('../src/scrapers/index');
let capturedArgs = null;
const original = microsoftModule.scrapeMicrosoftJobs;

microsoftModule.scrapeMicrosoftJobs = (...args) => {
  capturedArgs = args;
  return Promise.resolve({ result: [] });
};

delete require.cache[indexPath];
const { runScrapers } = require('../src/scrapers/index');

test('microsoft scraper does not default to fullSync in the app registry', async () => {
  await runScrapers(['microsoft']);
  assert.deepEqual(capturedArgs, ['', '', false]);
  microsoftModule.scrapeMicrosoftJobs = original;
});
