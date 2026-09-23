const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeJob } = require('../src/scrapers/google');

test('normalizeJob builds a Google job record with a stable id and apply URL', () => {
  const result = normalizeJob({
    title: 'Software Engineer III',
    href: 'https://www.google.com/about/careers/applications/jobs/results/123456789-software-engineer',
    location: 'Bengaluru, Karnataka, India',
  });

  assert.equal(result.source, 'Google');
  assert.equal(result.company, 'Google');
  assert.equal(result.positionId, '123456789');
  assert.equal(result.country, 'India');
  assert.equal(result.apply_url, 'https://www.google.com/about/careers/applications/jobs/results/123456789-software-engineer');
});