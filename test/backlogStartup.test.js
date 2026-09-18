const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldInitializeBacklog } = require('../src/app');

test('normal startup does not automatically initialize historical backlog', () => {
  const previous = process.env.ENABLE_BACKLOG_MIGRATION;
  delete process.env.ENABLE_BACKLOG_MIGRATION;
  assert.equal(shouldInitializeBacklog(), false);
  if (previous === undefined) delete process.env.ENABLE_BACKLOG_MIGRATION;
  else process.env.ENABLE_BACKLOG_MIGRATION = previous;
});
