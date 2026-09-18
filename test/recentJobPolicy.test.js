const test = require('node:test');
const assert = require('node:assert/strict');
const { filterJobsWithinRecentCutoff } = require('../src/utils/recentJobPolicy');

test('excludes jobs without a reliable posting date', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');
  const jobs = filterJobsWithinRecentCutoff([
    { id: 'recent', posted_date: '2026-09-04T12:00:00.000Z' },
    { id: 'old', posted_date: '2026-08-01T12:00:00.000Z' },
    { id: 'unknown' },
  ], { now, days: 3 });

  assert.deepEqual(jobs.map((job) => job.id), ['recent']);
});

test('retains jobs without posted_date when includeUnknownDate is true', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');
  const jobs = filterJobsWithinRecentCutoff([
    { id: 'known', posted_date: '2026-09-04T12:00:00.000Z' },
    { id: 'unknown' },
  ], { now, days: 3, includeUnknownDate: true });

  assert.deepEqual(jobs.map((job) => job.id), ['known', 'unknown']);
});

test('uses the shared JOB_LOOKBACK_DAYS config and defaults to 3 days', () => {
  const previous = process.env.JOB_LOOKBACK_DAYS;

  try {
    const now = new Date('2026-09-05T12:00:00.000Z');
    process.env.JOB_LOOKBACK_DAYS = '5';
    const jobs = filterJobsWithinRecentCutoff([
      { id: 'within', posted_date: '2026-09-01T12:00:00.000Z' },
      { id: 'outside', posted_date: '2026-08-25T12:00:00.000Z' },
    ], { now });

    assert.deepEqual(jobs.map((job) => job.id), ['within']);

    delete process.env.JOB_LOOKBACK_DAYS;
    const defaultJobs = filterJobsWithinRecentCutoff([
      { id: 'defaultRecent', posted_date: '2026-09-04T12:00:00.000Z' },
      { id: 'defaultOld', posted_date: '2026-08-30T12:00:00.000Z' },
    ], { now });

    assert.deepEqual(defaultJobs.map((job) => job.id), ['defaultRecent']);
  } finally {
    if (previous === undefined) {
      delete process.env.JOB_LOOKBACK_DAYS;
    } else {
      process.env.JOB_LOOKBACK_DAYS = previous;
    }
  }
});