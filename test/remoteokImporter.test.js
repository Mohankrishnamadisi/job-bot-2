const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeRemoteOkJob } = require('../src/services/jobs/fetchRemoteOkJobs');

test('normalizeRemoteOkJob maps Remote OK payload to the shared job schema', () => {
  const rawJob = {
    id: 123,
    position: 'Senior Engineer',
    company: 'Acme',
    location: 'Remote, US',
    tags: ['javascript', 'node'],
    salary: '$120k',
    url: 'https://remoteok.com/remote-jobs/123',
    description: '<p>Build things</p>',
    date: '2026-07-10'
  };

  const normalized = normalizeRemoteOkJob(rawJob);

  assert.ok(normalized);
  assert.equal(normalized.title, 'Senior Engineer');
  assert.equal(normalized.company_name, 'Acme');
  assert.equal(normalized.company, 'Acme');
  assert.equal(normalized.location, 'Remote, US');
  assert.equal(normalized.salary, '$120k');
  assert.equal(normalized.apply_url, 'https://remoteok.com/remote-jobs/123');
  assert.equal(normalized.description, 'Build things');
  assert.equal(normalized.external_job_id, '123');
  assert.deepEqual(normalized.skills, ['javascript', 'node']);
});
