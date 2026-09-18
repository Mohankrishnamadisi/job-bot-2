const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWeWorkRemotelyJob } = require('../src/services/jobs/fetchWeWorkRemotelyJobs');

test('normalizeWeWorkRemotelyJob maps RSS payload to the shared job schema', () => {
  const rawJob = {
    title: 'Mathmo: Maths Coach',
    link: 'https://weworkremotely.com/remote-jobs/mathmo-maths-coach',
    description: '<p>Great role</p>',
    pubDate: 'Wed, 10 Jul 2024 12:00:00 +0000',
    category: 'All Other Remote',
    region: 'Anywhere in the World',
    type: 'Contract',
    guid: 'mathmo-123',
    skills: 'Teaching, Math',
  };

  const normalized = normalizeWeWorkRemotelyJob(rawJob);

  assert.ok(normalized);
  assert.equal(normalized.title, 'Mathmo: Maths Coach');
  assert.equal(normalized.company_name, null);
  assert.equal(normalized.company, null);
  assert.equal(normalized.location, 'Anywhere in the World');
  assert.equal(normalized.employment_type, 'Contract');
  assert.equal(normalized.apply_url, 'https://weworkremotely.com/remote-jobs/mathmo-maths-coach');
  assert.equal(normalized.external_job_id, 'mathmo-123');
  assert.equal(normalized.description, 'Great role');
  assert.equal(normalized.summary, 'Great role');
  assert.deepEqual(normalized.skills, ['Teaching', 'Math']);
});
