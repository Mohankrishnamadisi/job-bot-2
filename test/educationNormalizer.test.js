const test = require('node:test');
const assert = require('node:assert/strict');

const { detectEducation } = require('../src/utils/educationNormalizer');

test('detectEducation maps common education terms to canonical values', () => {
  assert.equal(detectEducation({ title: 'Software Engineer', description: "Bachelor's degree required" }), "Bachelor's Degree");
  assert.equal(detectEducation({ description: 'Bachelor Degree' }), "Bachelor's Degree");
  assert.equal(detectEducation({ description: 'Graduate' }), "Bachelor's Degree");
  assert.equal(detectEducation({ description: 'M.Tech' }), 'M.Tech / ME');
  assert.equal(detectEducation({ description: 'BE' }), 'B.Tech / BE');
  assert.equal(detectEducation({ description: 'MBA' }), 'MBA');
  assert.equal(detectEducation({ description: 'Master\'s Degree' }), "Master's Degree");
  assert.equal(detectEducation({ description: 'PhD' }), 'PhD');
  assert.equal(detectEducation({ description: '12th Pass' }), '12th Pass');
  assert.equal(detectEducation({ description: '10th Pass' }), '10th Pass');
  assert.equal(detectEducation({ description: 'No Degree Required' }), 'No Formal Education');
  assert.equal(detectEducation({ title: 'Analyst' }), 'Not Specified');
});
