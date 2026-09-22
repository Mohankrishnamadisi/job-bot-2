'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/nttdata');

test('normalizes an NTT DATA job with India location and official apply URL', () => {
  const job = normalizeJob({
    jobId: '385486',
    title: 'ERP Specialist Advisor',
    location: 'PAN India, IN-KA, India',
    applyUrl: 'https://careers.nttdata.com/global/en/hvhapply?jobSeqNo=NTT1GLOBAL385486EXTERNALENGLOBAL',
  });

  assert.equal(job.positionId, '385486');
  assert.equal(job.company, 'NTT DATA');
  assert.equal(job.country, 'India');
  assert.match(job.apply_url, /careers\.nttdata\.com\/global\/en\/hvhapply/);
});

test('rejects cards without an official apply URL', () => {
  assert.equal(normalizeJob({ jobId: '1', title: 'Missing Apply Link' }), null);
});