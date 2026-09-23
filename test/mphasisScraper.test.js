'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/mphasis');

test('normalizes an official Mphasis RippleHire job', () => {
  const job = normalizeJob({ jobId: '118801-1-2', jobSeq: '910363', jobTitle: 'Principal Infrastr Eng', locations: 'New York', jobLocation: 'USA', jobReqExp: '5 - 8 Years' });
  assert.equal(job.positionId, '118801-1-2');
  assert.equal(job.company, 'Mphasis');
  assert.equal(job.location, 'New York');
  assert.match(job.apply_url, /#detail\/job\/910363/);
});

test('rejects incomplete Mphasis XML jobs', () => {
  assert.equal(normalizeJob({ jobId: '1' }), null);
});