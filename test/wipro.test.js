const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/wipro');

test('normalizeJob builds a deterministic Wipro apply URL and preserves key fields', () => {
  const input = {
    response: {
      id: '12345',
      unifiedStandardTitle: 'Senior Engineer',
      urlTitle: 'senior-engineer',
      sfstd_jobLocation_obj: ['Bengaluru', 'Hyderabad'],
      jobLocationCountry: ['India'],
      unifiedStandardStart: '6/15/26',
    },
  };

  const result = normalizeJob(input);

  assert.equal(result.positionId, '12345');
  assert.equal(result.title, 'Senior Engineer');
  assert.equal(result.location, 'Bengaluru, Hyderabad');
  assert.equal(result.country, 'India');
  assert.equal(result.apply_url, 'https://careers.wipro.com/job/senior-engineer/12345-en_US');
  assert.equal(result.source, 'Wipro');
  assert.equal(result.company, 'Wipro');
  assert.equal(result.status, 'open');
  assert.equal(result.is_active, true);
});
