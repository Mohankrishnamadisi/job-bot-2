const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeJob } = require('../src/scrapers/ibm');

test('normalizeJob builds an IBM job record with a stable apply URL and job id', () => {
  const result = normalizeJob({
    title: 'Software Developer',
    href: 'https://careers.ibm.com/en_US/careers/JobDetail?jobId=131237&source=WEB_Search_NA',
    location: 'Bangalore, IN',
  });

  assert.equal(result.source, 'IBM');
  assert.equal(result.company, 'IBM');
  assert.equal(result.positionId, '131237');
  assert.equal(result.title, 'Software Developer');
  assert.equal(result.location, 'Bangalore, IN');
  assert.equal(result.country, 'India');
  assert.equal(result.apply_url, 'https://careers.ibm.com/en_US/careers/JobDetail?jobId=131237&source=WEB_Search_NA');
});