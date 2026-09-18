const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGreenhouseJob, fetchGreenhouseBoardJobs } = require('../src/services/jobs/fetchGreenhouseJobs');

test('normalizeGreenhouseJob maps Greenhouse payload fields into the existing job shape', () => {
  const rawJob = {
    id: 123,
    title: 'Senior Backend Engineer',
    absolute_url: 'https://boards.greenhouse.io/example/jobs/123',
    location: { name: 'Remote - US' },
    content: '<p>Build resilient systems</p>',
    updated_at: '2026-01-01T12:00:00Z',
    metadata: [{ name: 'Employment Type', value: 'Full-time' }],
  };

  const normalized = normalizeGreenhouseJob(rawJob, 'cloudflare');

  assert.equal(normalized.title, 'Senior Backend Engineer');
  assert.equal(normalized.company_name, 'Cloudflare');
  assert.equal(normalized.apply_url, 'https://boards.greenhouse.io/example/jobs/123');
  assert.equal(normalized.work_mode, 'remote');
  assert.equal(normalized.employment_type, 'Full-time');
  assert.equal(normalized.source, 'greenhouse');
  assert.ok(typeof normalized.posted_date === 'string' && normalized.posted_date.includes('T'));
});

test('fetchGreenhouseBoardJobs returns board-level stats for fetched, inserted, skipped, failed', async () => {
  const stats = await fetchGreenhouseBoardJobs('notion', {
    axiosClient: {
      get: async () => ({
        data: {
          jobs: [
            {
              id: 1,
              title: 'Engineer I',
              absolute_url: 'https://boards.greenhouse.io/notion/jobs/1',
              location: { name: 'Remote' },
              content: '<p>Role 1</p>',
              updated_at: new Date().toISOString(),
            },
            {
              id: 2,
              title: 'Engineer II',
              absolute_url: 'https://boards.greenhouse.io/notion/jobs/2',
              location: { name: 'San Francisco, CA' },
              content: '<p>Role 2</p>',
              updated_at: new Date().toISOString(),
            },
          ],
        },
      }),
    },
    deduplicateJobsFn: async () => ({
      uniqueJobs: [{ applyUrl: 'https://boards.greenhouse.io/notion/jobs/1' }],
      duplicateJobs: [{ reason: 'applyUrl already exists' }],
      duplicateCount: 1,
    }),
    saveJobsFn: async () => ({
      data: [{ id: 'db-1', apply_url: 'https://boards.greenhouse.io/notion/jobs/1' }],
      error: null,
      stats: { inserted: 1, skippedDuplicates: 0 },
    }),
  });

  assert.equal(stats.board, 'notion');
  assert.equal(stats.fetched, 2);
  assert.equal(stats.inserted, 0);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.normalized, 2);
});