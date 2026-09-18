const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeJob } = require('../src/scrapers/deloitte');

test('normalizeJob builds a Deloitte detail record', () => {
  const result = normalizeJob({
    title: 'Project Manager',
    href: 'https://apply.deloitte.com/en_US/careers/JobDetail/Project-Manager/367162',
    location: 'Hyderabad, India',
  });

  assert.equal(result.source, 'Deloitte');
  assert.equal(result.company, 'Deloitte');
  assert.equal(result.positionId, '367162');
  assert.equal(result.apply_url, 'https://apply.deloitte.com/en_US/careers/JobDetail/Project-Manager/367162');
});