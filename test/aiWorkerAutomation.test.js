const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureBacklogQueueEntries } = require('../src/database/jobRepository');

test('ensureBacklogQueueEntries inserts only missing queue rows for historical raw jobs', async () => {
  const insertedPayloads = [];
  const fakeSupabase = {
    from(table) {
      if (table === 'raw_jobs') {
        return {
          select() {
            return Promise.resolve({ data: [{ id: 101 }, { id: 102 }], error: null });
          },
        };
      }

      if (table === 'ai_queue') {
        return {
          select() {
            return Promise.resolve({ data: [{ raw_job_id: 102 }], error: null });
          },
          insert(payload) {
            insertedPayloads.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await ensureBacklogQueueEntries({
    supabase: fakeSupabase,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  });

  assert.equal(result.inserted, 1);
  assert.equal(insertedPayloads.length, 1);
  assert.equal(insertedPayloads[0][0].raw_job_id, 101);
  assert.equal(insertedPayloads[0][0].status, 'Pending');
  assert.equal(insertedPayloads[0][0].retry_count, 0);
});
