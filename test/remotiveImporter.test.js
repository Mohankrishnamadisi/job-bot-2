const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeRemotiveJob } = require('../src/services/jobs/fetchRemotiveJobs');

test('normalizeRemotiveJob maps Remotive payload to the shared job schema', () => {
  const rawJob = {
    id: 2091056,
    url: 'https://remotive.com/remote-jobs/software-development/staff-software-engineer-product-belo-horizonte-2091056',
    title: 'Staff Software Engineer, Product (Belo Horizonte)',
    company_name: 'LawnStarter',
    category: 'Software Development',
    tags: ['AWS', 'backend', 'frontend'],
    job_type: 'full_time',
    publication_date: '2026-07-09T14:45:43',
    candidate_required_location: 'Brazil',
    salary: '$80k - $100k',
    description: '<p>Build things</p>'
  };

  const normalized = normalizeRemotiveJob(rawJob);

  assert.ok(normalized);
  assert.equal(normalized.title, 'Staff Software Engineer, Product (Belo Horizonte)');
  assert.equal(normalized.company_name, 'LawnStarter');
  assert.equal(normalized.company, 'LawnStarter');
  assert.equal(normalized.location, 'Brazil');
  assert.equal(normalized.work_mode, 'remote');
  assert.equal(normalized.employment_type, 'full_time');
  assert.equal(normalized.salary, '$80k - $100k');
  assert.equal(normalized.description, 'Build things');
  assert.equal(normalized.summary, 'Build things');
  assert.deepEqual(normalized.skills, ['AWS', 'backend', 'frontend']);
  assert.equal(normalized.apply_url, 'https://remotive.com/remote-jobs/software-development/staff-software-engineer-product-belo-horizonte-2091056');
  assert.equal(normalized.external_job_id, '2091056');
});
