const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverStaleProcessing } = require('../src/workers/aiWorker');

test('stale Processing rows are retried or failed while active rows are untouched', async () => {
  const updates = [];
  const staleRows = [
    { id: 'retry-me', retry_count: 1 },
    { id: 'fail-me', retry_count: 2 },
  ];
  const makeQuery = (mode) => {
    const query = {
      eq() { return query; },
      lt() { return query; },
      select() { return query; },
      update(payload) {
        updates.push({ id: mode, payload });
        return query;
      },
      then(resolve) {
        resolve(mode === 'load' ? { data: staleRows, error: null } : { data: [], error: null });
      },
    };
    return query;
  };
  const supabase = {
    from() {
      return makeQuery(updates.length === 0 ? 'load' : staleRows[updates.length - 1]?.id);
    },
  };

  const result = await recoverStaleProcessing({ supabase, logger: { warn() {} } });

  assert.equal(result.recovered, 2);
  assert.equal(updates[0].payload.status, 'Pending');
  assert.equal(updates[0].payload.retry_count, 2);
  assert.equal(updates[1].payload.status, 'Failed');
  assert.equal(updates[1].payload.retry_count, 3);
});
