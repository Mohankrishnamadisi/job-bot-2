const test = require('node:test');
const assert = require('node:assert/strict');

const { detectWorkMode } = require('../src/utils/workModeDetector');

test('detectWorkMode prioritizes remote-only sources and text signals', () => {
  assert.equal(detectWorkMode({ source: 'RemoteOK' }), 'Remote');
  assert.equal(detectWorkMode({ source: 'Remotive' }), 'Remote');
  assert.equal(detectWorkMode({ source: 'We Work Remotely' }), 'Remote');
  assert.equal(detectWorkMode({ location: 'Remote - India' }), 'Remote');
  assert.equal(detectWorkMode({ description: 'Work From Home' }), 'Remote');
  assert.equal(detectWorkMode({ description: 'Hybrid' }), 'Hybrid');
  assert.equal(detectWorkMode({ description: 'Work From Office' }), 'Onsite');
  assert.equal(detectWorkMode({ title: 'Unknown Role' }), 'Unknown');
});
