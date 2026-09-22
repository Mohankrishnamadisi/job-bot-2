'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/ltimindtree');

test('normalizes an LTIMindtree RippleHire job', () => {
  const job = normalizeJob({ jobId: '896487', title: 'Specialist - Quality Engineering', location: 'Chennai, India', applyUrl: 'https://ltimindtree.ripplehire.com/candidate/?token=x#detail/job/896487' });
  assert.equal(job.positionId, '896487');
  assert.equal(job.company, 'LTIMindtree');
  assert.equal(job.country, 'India');
  assert.match(job.apply_url, /#detail\/job\/896487/);
});

test('rejects incomplete LTIMindtree cards', () => {
  assert.equal(normalizeJob({ jobId: '1', title: 'Missing URL' }), null);
});