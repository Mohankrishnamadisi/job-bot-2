const test = require('node:test');
const assert = require('node:assert/strict');
const { mapRawJobToProcessedJob } = require('../src/workers/aiWorker');

test('mapRawJobToProcessedJob maps raw job fields into processed job payload', () => {
  const payload = mapRawJobToProcessedJob({
    id: 42,
    company_id: 7,
    title: 'Engineer',
    location: 'Remote',
    experience: '3+ years',
    employment_type: 'Full-time',
    work_mode: 'Remote',
    salary: '$120k',
    description: 'Build things',
    summary: 'Great role',
    skills: ['Node.js', 'Postgres'],
    apply_url: 'https://example.com/apply',
    source: 'ATS',
    posted_date: '2024-01-01',
    expiry_date: '2024-02-01',
    status: 'active',
    is_active: true,
  });

  assert.equal(payload.raw_job_id, 42);
  assert.equal(payload.company_id, 7);
  assert.equal(payload.title, 'Engineer');
  assert.equal(payload.ai_processed, true);
  assert.equal(payload.ai_model, process.env.GROQ_MODEL || process.env.OLLAMA_MODEL || 'unknown');
  assert.equal(payload.status, 'active');
  assert.equal(payload.is_active, true);
});
