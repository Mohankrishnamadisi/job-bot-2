const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSalary } = require('../src/utils/salaryNormalizer');

test('normalizeSalary parses Indian, US, EU, and UK formats into canonical values', () => {
  assert.deepEqual(normalizeSalary('₹6-10 LPA'), { salary: '600000-1000000', currency: 'INR' });
  assert.deepEqual(normalizeSalary('₹8 LPA'), { salary: '800000-800000', currency: 'INR' });
  assert.deepEqual(normalizeSalary('₹900,000 per annum'), { salary: '900000-900000', currency: 'INR' });
  assert.deepEqual(normalizeSalary('USD $106,400 - $203,600'), { salary: '106400-203600', currency: 'USD' });
  assert.deepEqual(normalizeSalary('$120000'), { salary: '120000-120000', currency: 'USD' });
  assert.deepEqual(normalizeSalary('€80000'), { salary: '80000-80000', currency: 'EUR' });
  assert.deepEqual(normalizeSalary('£60000'), { salary: '60000-60000', currency: 'GBP' });
});

test('normalizeSalary returns nulls for non-structured salary text', () => {
  assert.deepEqual(normalizeSalary('Competitive Salary'), { salary: null, currency: null });
  assert.deepEqual(normalizeSalary('Negotiable'), { salary: null, currency: null });
  assert.deepEqual(normalizeSalary('Depends on Experience'), { salary: null, currency: null });
  assert.deepEqual(normalizeSalary('Market Rate'), { salary: null, currency: null });
  assert.deepEqual(normalizeSalary('Not Disclosed'), { salary: null, currency: null });
});
