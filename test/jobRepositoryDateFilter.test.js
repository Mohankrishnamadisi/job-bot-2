const test = require('node:test');
const assert = require('node:assert/strict');
const { isJobPostedWithinLast24Hours } = require('../src/database/jobRepository');

test('allows jobs without a valid posting date through the persistence date filter', () => {
  assert.equal(isJobPostedWithinLast24Hours({}), true);
  assert.equal(isJobPostedWithinLast24Hours({ posted_date: null }), true);
  assert.equal(isJobPostedWithinLast24Hours({ posted_date: 'not-a-date' }), true);
});

test('filters jobs with a valid posting date that is older than 24 hours', () => {
  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  assert.equal(isJobPostedWithinLast24Hours({ posted_date: oldDate }), false);
});

test('keeps jobs with a valid posting date that is within the last 24 hours', () => {
  const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(isJobPostedWithinLast24Hours({ posted_date: recentDate }), true);
});
