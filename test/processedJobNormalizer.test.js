const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeExperience,
  normalizeEmploymentType,
  normalizeLocationForWorkMode,
} = require('../src/utils/processedJobNormalizer');

test('normalizeExperience maps common experience values to standard strings', () => {
  assert.equal(normalizeExperience('0-1 years'), '0-1 Years');
  assert.equal(normalizeExperience('1 to 3 years'), '1-3 Years');
  assert.equal(normalizeExperience('3+ years'), '3+ Years');
  assert.equal(normalizeExperience('4-6 years'), '4-6 Years');
  assert.equal(normalizeExperience('5+ years'), '5-8 Years');
  assert.equal(normalizeExperience('6 years'), '5-8 Years');
  assert.equal(normalizeExperience('7+ years'), '5-8 Years');
  assert.equal(normalizeExperience('9 years'), '8-10 Years');
  assert.equal(normalizeExperience('12 years'), '10+ Years');
  assert.equal(normalizeExperience('15+ years'), '10+ Years');
  assert.equal(normalizeExperience('10 years or more'), '10+ Years');
  assert.equal(normalizeExperience('fresher'), 'Fresher');
  assert.equal(normalizeExperience('any experience'), 'Any Experience');
  assert.equal(normalizeExperience(''), 'Any Experience');
});

test('normalizeEmploymentType maps common values to canonical values', () => {
  assert.equal(normalizeEmploymentType('full-time'), 'Full-Time');
  assert.equal(normalizeEmploymentType('part time'), 'Part-Time');
  assert.equal(normalizeEmploymentType('intern'), 'Internship');
  assert.equal(normalizeEmploymentType('temporary'), 'Contract');
  assert.equal(normalizeEmploymentType('freelance'), 'Freelance');
  assert.equal(normalizeEmploymentType('unknown'), 'Full-Time');
});

test('normalizeLocationForWorkMode corrects remote and hybrid work modes from location text', () => {
  assert.deepEqual(normalizeLocationForWorkMode('Remote - India', 'Onsite'), { location: 'Remote - India', workMode: 'Remote' });
  assert.deepEqual(normalizeLocationForWorkMode('Hybrid - Bangalore', 'Onsite'), { location: 'Hybrid - Bangalore', workMode: 'Hybrid' });
  assert.deepEqual(normalizeLocationForWorkMode('Onsite - Hyderabad', 'Remote'), { location: 'Onsite - Hyderabad', workMode: 'Onsite' });
});
