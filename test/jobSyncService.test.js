const test = require('node:test');
const assert = require('node:assert/strict');
const { findJobsForSync } = require('../src/parsers/common/jobSyncService');

test('findJobsForSync falls back to all-source rows when the direct existing lookup is empty', () => {
  const allJobs = [{ apply_url: 'https://example.com/job/1', title: 'Engineer' }];
  const existingRows = [];
  const allSourceRows = [{ apply_url: 'https://example.com/job/1', title: 'Engineer', is_active: true }];

  const result = findJobsForSync(allJobs, existingRows, allSourceRows);

  assert.equal(result.newJobs.length, 0);
  assert.equal(result.existingMatches.length, 1);
  assert.equal(result.removedRows.length, 0);
});
