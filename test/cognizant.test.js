const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/cognizant');

test('normalizeJob builds a Cognizant job record with a stable apply URL', () => {
  const result = normalizeJob({
    title: 'Senior Full Stack Engineer',
    href: 'https://careers.cognizant.com/global/en/job/123456',
    location: 'Bengaluru, India',
    description: 'Build scalable products for a global client.',
  });

  assert.equal(result.title, 'Senior Full Stack Engineer');
  assert.equal(result.source, 'Cognizant');
  assert.equal(result.company, 'Cognizant');
  assert.equal(result.location, 'Bengaluru, India');
  assert.equal(result.apply_url, 'https://careers.cognizant.com/global/en/job/123456');
  assert.equal(result.status, 'open');
  assert.equal(result.is_active, true);
});
