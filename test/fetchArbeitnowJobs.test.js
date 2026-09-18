const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArbeitnowJob, buildDuplicateCheckKey } = require('../src/services/jobs/fetchArbeitnowJobs');

test('normalizeArbeitnowJob maps Arbeitnow payload fields into the existing job shape', () => {
  const rawJob = {
    title: 'Senior Engineer',
    company_name: 'Example Labs',
    description: 'Build amazing things',
    remote: true,
    location: 'Remote',
    url: 'https://example.com/job/1',
    created_at: 1710000000,
    tags: ['Backend'],
    job_types: ['vollzeit']
  };

  const normalized = normalizeArbeitnowJob(rawJob);

  assert.equal(normalized.title, 'Senior Engineer');
  assert.equal(normalized.company_name, 'Example Labs');
  assert.equal(normalized.apply_url, 'https://example.com/job/1');
  assert.equal(normalized.work_mode, 'remote');
  assert.equal(normalized.source, 'arbeitnow');
  assert.ok(typeof normalized.posted_date === 'string' && normalized.posted_date.includes('T'));
});

test('buildDuplicateCheckKey uses title, company name, and apply URL', () => {
  const job = {
    title: 'Staff Engineer',
    company_name: 'Example Labs',
    apply_url: 'https://example.com/job/2'
  };

  assert.equal(buildDuplicateCheckKey(job), 'staff engineer|example labs|https://example.com/job/2');
});
