const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleAiWorker, scheduleDb1Sync } = require('../src/scheduler/cron');

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

test('DB1 sync scheduler repeats after the configured interval', async () => {
  let syncCalls = 0;
  let scheduledCallback = null;
  let scheduledDelay = null;
  const scheduler = scheduleDb1Sync({
    intervalMs: 5 * 60 * 60 * 1000,
    sync: async () => {
      syncCalls += 1;
    },
    loggerInstance: { warn() {}, error() {} },
    setTimeoutFn(callback, delay) {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return { unref() {} };
    },
  });

  assert.equal(syncCalls, 0);
  assert.equal(scheduledDelay, 5 * 60 * 60 * 1000);

  await scheduledCallback();
  assert.equal(syncCalls, 1);
  assert.equal(scheduledDelay, 5 * 60 * 60 * 1000);

  await scheduledCallback();
  assert.equal(syncCalls, 2);
  assert.equal(scheduledDelay, 5 * 60 * 60 * 1000);

  scheduler.stop();
});