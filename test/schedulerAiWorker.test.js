const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleAiWorker } = require('../src/scheduler/cron');

test('AI scheduler skips a trigger while the previous worker cycle is running', async () => {
  let resolveWorker;
  let workerCalls = 0;
  let scheduledCallback = null;
  const warnings = [];
  const workerPromise = new Promise((resolve) => {
    resolveWorker = resolve;
  });

  const scheduler = scheduleAiWorker({
    batchSize: 2,
    intervalMs: 60000,
    worker: async () => {
      workerCalls += 1;
      await workerPromise;
    },
    loggerInstance: {
      warn(message) {
        warnings.push(message);
      },
      error() {},
    },
    setTimeoutFn(callback) {
      scheduledCallback = callback;
      return { unref() {} };
    },
  });

  await Promise.resolve();
  await scheduler.trigger();

  assert.equal(workerCalls, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /already running/);

  resolveWorker();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof scheduledCallback, 'function');

  scheduler.stop();
});