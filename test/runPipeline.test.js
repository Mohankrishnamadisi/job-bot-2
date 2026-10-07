const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/runPipeline');

test('one-shot runner runs one pipeline cycle and awaits browser cleanup', async () => {
  const output = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  let pipelineCalls = 0;
  let cleanupCalls = 0;

  console.log = (message) => output.push(String(message));
  console.error = (message) => output.push(String(message));

  try {
    const exitCode = await main({
      runPipeline: async (options) => {
        pipelineCalls += 1;
        assert.deepEqual(options, { throwOnError: true, awaitTimedOutScrapers: true });
      },
      closeBrowserFn: async () => {
        cleanupCalls += 1;
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(process.exitCode, 0);
    assert.equal(pipelineCalls, 1);
    assert.equal(cleanupCalls, 1);
    assert.ok(output.includes('SCRAPE_ONCE_STARTED'));
    assert.ok(output.includes('SCRAPE_ONCE_COMPLETED'));
    assert.ok(output.some((line) => /^TOTAL_RUNTIME_MS=\d+$/.test(line)));
    assert.ok(output.some((line) => /^TOTAL_RUNTIME_SECONDS=\d+\.\d{3}$/.test(line)));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});

test('one-shot runner reports pipeline failures and exits with a nonzero code', async () => {
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  let cleanupCalls = 0;

  console.log = () => {};
  console.error = (message) => errors.push(String(message));

  try {
    const exitCode = await main({
      runPipeline: async () => {
        throw new Error('pipeline failed');
      },
      closeBrowserFn: async () => {
        cleanupCalls += 1;
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(process.exitCode, 1);
    assert.equal(cleanupCalls, 1);
    assert.ok(errors.includes('SCRAPE_ONCE_FAILED'));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});
