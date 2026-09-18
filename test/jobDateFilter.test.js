const test = require('node:test');
const assert = require('node:assert/strict');
const { isRecentJob, filterRecentJobs } = require('../src/utils/jobDateFilter');

test('keeps jobs without posted dates', () => {
  assert.equal(isRecentJob(null, 15), true);
  assert.equal(isRecentJob(undefined, 15), true);
  assert.equal(isRecentJob('', 15), true);
});

test('keeps jobs with unparseable posted dates', () => {
  const filtered = filterRecentJobs([{ title: 'Invalid', posted_date: 'not-a-date' }], 15);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Invalid');
});

test('filters jobs older than the configured retention window', () => {
  const now = new Date();
  const recent = { title: 'Recent', posted_date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  const old = { title: 'Old', posted_date: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString() };

  const filtered = filterRecentJobs([recent, old], 15);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Recent');
});
