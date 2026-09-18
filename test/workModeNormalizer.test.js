const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWorkMode } = require('../src/utils/workModeNormalizer');

test('normalizeWorkMode maps common variants to canonical values', () => {
  assert.equal(normalizeWorkMode('onsite'), 'Onsite');
  assert.equal(normalizeWorkMode('On-site'), 'Onsite');
  assert.equal(normalizeWorkMode('on site'), 'Onsite');
  assert.equal(normalizeWorkMode('office'), 'Onsite');
  assert.equal(normalizeWorkMode('work from office'), 'Onsite');
  assert.equal(normalizeWorkMode('unknown'), 'Unknown');
  assert.equal(normalizeWorkMode('remote'), 'Remote');
  assert.equal(normalizeWorkMode('work from home'), 'Remote');
  assert.equal(normalizeWorkMode('wfh'), 'Remote');
  assert.equal(normalizeWorkMode('hybrid'), 'Hybrid');
  assert.equal(normalizeWorkMode(''), 'Unknown');
  assert.equal(normalizeWorkMode(null), 'Unknown');
});
