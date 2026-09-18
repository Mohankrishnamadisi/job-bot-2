const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSaveJob } = require('../src/parsers/common/jobFilters');

test('shouldSaveJob accepts array-based locations for India jobs', () => {
  const job = {
    location: ['Chennai'],
    country: 'India',
    work_mode: 'onsite',
    description: 'Software engineer role',
  };

  assert.equal(shouldSaveJob(job), true);
});

test('shouldSaveJob accepts array-based locations for remote jobs', () => {
  const job = {
    location: ['Remote'],
    work_mode: 'Remote',
    description: 'Work from home opportunity',
  };

  assert.equal(shouldSaveJob(job), true);
});
