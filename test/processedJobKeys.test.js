const test = require('node:test');
const assert = require('node:assert/strict');

const jobRepositoryPath = require.resolve('../src/database/jobRepository');
const supabaseClientPath = require.resolve('../src/database/supabaseClient');
const companyRepositoryPath = require.resolve('../src/database/companyRepository');
const aiPath = require.resolve('../src/ai');

function clearModuleCache() {
  delete require.cache[jobRepositoryPath];
  delete require.cache[supabaseClientPath];
  delete require.cache[companyRepositoryPath];
  delete require.cache[aiPath];
}

test('saveJobs ignores processed_job_keys for raw ingestion and deduplicates raw queue work', async () => {
  clearModuleCache();

  const rawJobsInsertCalls = [];
  const aiQueueInsertCalls = [];
  const processedKeyCalls = [];
  let rawJobsSelectCallCount = 0;

  const supabaseStub = {
    from(table) {
      if (table === 'processed_job_keys') {
        processedKeyCalls.push('select');
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: [{ apply_url: 'https://example.com/existing' }], error: null });
              },
            };
          },
          upsert() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      }

      if (table === 'companies') {
        return {
          select() {
            return {
              ilike() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
          insert() {
            return {
              select() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'raw_jobs') {
        rawJobsInsertCalls.push(table);
        return {
          select() {
            return {
              in() {
                rawJobsSelectCallCount += 1;
                const response = rawJobsSelectCallCount === 1
                  ? { data: [{ id: 'raw-job-existing', apply_url: 'https://example.com/existing' }], error: null }
                  : { data: [{ id: 'raw-job-new', apply_url: 'https://example.com/new' }], error: null };
                return Promise.resolve(response);
              },
            };
          },
          upsert() {
            return {
              select() {
                return Promise.resolve({ data: [{ id: 'raw-job-1', apply_url: 'https://example.com/new' }], error: null });
              },
            };
          },
        };
      }

      if (table === 'ai_queue') {
        aiQueueInsertCalls.push(table);
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          insert() {
            aiQueueInsertCalls.push('insert');
            return Promise.resolve({ data: [], error: null });
          },
        };
      }

      if (table === 'information_schema.columns') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }

      return {
        select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; },
        insert() { return Promise.resolve({ data: [], error: null }); },
        upsert() { return Promise.resolve({ data: [], error: null }); },
      };
    },
  };

  require.cache[supabaseClientPath] = {
    id: supabaseClientPath,
    filename: supabaseClientPath,
    loaded: true,
    exports: supabaseStub,
  };

  require.cache[companyRepositoryPath] = {
    id: companyRepositoryPath,
    filename: companyRepositoryPath,
    loaded: true,
    exports: {
      getCompanyByName: async () => ({ id: 'company-1' }),
      ensureCompany: async () => ({ id: 'company-1' }),
    },
  };

  require.cache[aiPath] = {
    id: aiPath,
    filename: aiPath,
    loaded: true,
    exports: {
      createJobEnricher: () => async (job) => job,
    },
  };

  const { saveJobs } = require('../src/database/jobRepository');

  const result = await saveJobs([
    { title: 'Existing Job', company: 'Test Company', apply_url: 'https://example.com/existing' },
    { title: 'New Job', company: 'Test Company', apply_url: 'https://example.com/new' },
  ]);

  assert.equal(processedKeyCalls.length, 0);
  assert.equal(result.stats.inserted, 1);
  assert.equal(result.stats.updated, 1);
  assert.equal(result.stats.skippedDuplicates, 0);
  assert.ok(rawJobsInsertCalls.length >= 1);
  assert.equal(aiQueueInsertCalls.filter((call) => call === 'insert').length, 1);
});
