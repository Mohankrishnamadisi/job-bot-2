'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob } = require('../src/scrapers/sap');

test('SAP scraper normalizes SuccessFactors job records', () => {
  const job = normalizeJob({
    jobId: '12345',
    title: '  Senior Software Engineer  ',
    location: 'Bangalore, India',
    href: 'https://careers.sap.com/job/Bangalore-Senior-Software-Engineer/12345/',
  });

  assert.equal(job.source, 'SAP');
  assert.equal(job.company, 'SAP');
  assert.equal(job.title, 'Senior Software Engineer');
  assert.equal(job.country, 'India');
  assert.equal(job.positionId, '12345');
  assert.equal(job.apply_url, 'https://careers.sap.com/job/Bangalore-Senior-Software-Engineer/12345/');
});

test('SAP scraper rejects incomplete records', () => {
  assert.equal(normalizeJob({ title: 'Missing URL' }), null);
  assert.equal(normalizeJob({ href: 'https://careers.sap.com/job/123' }), null);
});