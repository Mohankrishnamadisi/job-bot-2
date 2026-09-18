const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCompanyIdForJob, buildAiQueuePayloadsForNewRawJobs } = require('../src/database/jobRepository');

test('resolveCompanyIdForJob reuses an existing company when names match case-insensitively', async () => {
  const companyId = await resolveCompanyIdForJob(
    { company_name: '  Example Labs  ' },
    {
      getCompanyByName: async (name) => {
        assert.equal(name, 'Example Labs');
        return { id: 'company-123' };
      },
      ensureCompany: async () => {
        throw new Error('ensureCompany should not be called when a match already exists');
      },
    }
  );

  assert.equal(companyId, 'company-123');
});

test('resolveCompanyIdForJob creates a company when one does not exist', async () => {
  const companyId = await resolveCompanyIdForJob(
    { company_name: '  New Co  ' },
    {
      getCompanyByName: async () => null,
      ensureCompany: async (payload) => {
        assert.equal(payload.name, 'New Co');
        return { id: 'company-456' };
      },
    }
  );

  assert.equal(companyId, 'company-456');
});

test('buildAiQueuePayloadsForNewRawJobs creates one pending queue record per new raw job', () => {
  const queuePayloads = buildAiQueuePayloadsForNewRawJobs([
    { id: 1, apply_url: 'https://a.example' },
    { id: 2, apply_url: 'https://b.example' },
    { id: 3, apply_url: 'https://a.example' },
  ], [
    { raw_job_id: 1 },
    { raw_job_id: 2 },
  ]);

  assert.deepEqual(queuePayloads, [
    {
      raw_job_id: 3,
      status: 'Pending',
      retry_count: 0,
    },
  ]);
});
