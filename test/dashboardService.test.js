const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardSummary } = require('../src/dashboard/dashboardService');

test('buildDashboardSummary aggregates the key pipeline metrics', () => {
  const summary = buildDashboardSummary({
    rawJobsCount: 12,
    processedJobsCount: 7,
    jobsCount: 3,
    aiQueueStatusCounts: {
      Pending: 2,
      Processing: 1,
      Failed: 1,
      Completed: 8,
    },
    companyCount: 4,
    recentFailures: [
      {
        id: 'queue-1',
        raw_job_id: 'raw-1',
        last_error: 'AI timeout while enriching job description',
        updated_at: '2026-07-18T10:00:00.000Z',
      },
    ],
  });

  assert.equal(summary.overview.rawJobs, 12);
  assert.equal(summary.overview.processedJobs, 7);
  assert.equal(summary.overview.jobs, 3);
  assert.equal(summary.queue.pending, 2);
  assert.equal(summary.queue.processing, 1);
  assert.equal(summary.queue.failed, 1);
  assert.equal(summary.companyCount, 4);
  assert.equal(summary.health.status, 'warning');
  assert.equal(summary.recentFailures[0].message, 'AI timeout while enriching job description');
});
