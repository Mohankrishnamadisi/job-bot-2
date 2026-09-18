const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeJob } = require('../src/scrapers/cisco');

test('normalizeJob builds a Cisco detail record', () => {
  const result = normalizeJob({
    jobId: '2020626',
    title: 'Software Engineer',
    cityState: 'Hyderabad, Telangana',
    country: 'India',
  });

  assert.equal(result.source, 'Cisco');
  assert.equal(result.company, 'Cisco');
  assert.equal(result.positionId, '2020626');
  assert.equal(result.location, 'Hyderabad, Telangana');
  assert.equal(result.apply_url, 'https://careers.cisco.com/global/en/job/2020626/software-engineer');
});