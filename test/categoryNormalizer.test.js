const test = require('node:test');
const assert = require('node:assert/strict');

const { generateCategory } = require('../src/utils/categoryNormalizer');

test('generateCategory maps known roles to the expected categories', () => {
  assert.equal(generateCategory({ title: 'React Developer' }), 'Software Development');
  assert.equal(generateCategory({ title: 'AI Engineer' }), 'Artificial Intelligence');
  assert.equal(generateCategory({ title: 'Data Scientist' }), 'Data Science');
  assert.equal(generateCategory({ title: 'QA Engineer' }), 'Quality Assurance');
  assert.equal(generateCategory({ title: 'HR Recruiter' }), 'Human Resources');
  assert.equal(generateCategory({ title: 'Unknown Role' }), 'Other');
});
