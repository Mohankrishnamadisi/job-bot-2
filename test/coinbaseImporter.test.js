'use strict';

const assert = require('assert');
const { normalizeCoinbaseJob } = require('../src/services/jobs/fetchCoinbaseJobs');

const sampleJob = {
  id: 123,
  title: 'Software Engineer',
  absolute_url: 'https://www.coinbase.com/careers/positions/123',
  location: { name: 'Remote - US' },
  content: '<p>Build product</p>',
  updated_at: '2024-01-02T03:04:05.000Z',
};

const normalized = normalizeCoinbaseJob(sampleJob);
assert.ok(normalized, 'expected a normalized job');
assert.strictEqual(normalized.company_name, 'Coinbase');
assert.strictEqual(normalized.apply_url, sampleJob.absolute_url);
assert.strictEqual(normalized.source, 'coinbase');
assert.strictEqual(normalized.work_mode, 'remote');
console.log('coinbase importer test passed');
