const test = require('node:test');
const assert = require('node:assert/strict');

const { publishPendingJobs } = require('../src/publisher/publisher');

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function createQueryResult(data, error = null) {
  const result = { data, error };
  result.select = () => result;
  result.eq = () => result;
  result.neq = () => result;
  result.maybeSingle = () => result;
  result.single = () => result;
  return result;
}

test('publishPendingJobs maps processed jobs to jobs and marks them published', async () => {
  const updates = [];
  const inserts = [];

  const mockSupabase = {
    from(table) {
      if (table === 'processed_jobs') {
        return {
          select() {
            return createQueryResult([{ 
              id: 'processed-1',
              title: 'Software Engineer',
              company_id: 'company-1',
              location: 'Remote',
              employment_type: 'Full Time',
              work_mode: 'On-site',
              salary: '800000-1200000',
              currency: 'INR',
              experience: '3+ years',
              education: "Bachelor's Degree",
              description: 'Build products',
              category: 'Software Development',
              skills: ['Node.js', 'React'],
              apply_url: 'https://example.com/apply',
              expiry_date: '2026-12-31',
              status: 'active',
              is_active: true,
              published: false,
              retry_count: 0,
            }]);
          },
          update(payload) {
            updates.push({ table, payload });
            return {
              eq() {
                return { data: null, error: null };
              },
            };
          },
        };
      }

      if (table === 'companies') {
        return {
          select() {
            return createQueryResult({ id: 'company-1', name: 'Acme', logo_url: 'https://cdn.example.com/logo.png' });
          },
        };
      }

      if (table === 'jobs') {
        return {
          select() {
            return createQueryResult(null);
          },
          insert(payload) {
            inserts.push(payload);
            return {
              select() {
                return {
                  single() {
                    return { data: { id: 'job-1' }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await publishPendingJobs({ supabase: mockSupabase, logger: createLogger() });

  assert.equal(result.publishedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.skippedCount, 0);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].company_name, 'Acme');
  assert.equal(inserts[0].company_logo_url, 'https://cdn.example.com/logo.png');
  assert.equal(inserts[0].job_type, 'Full-Time');
  assert.equal(inserts[0].location, 'Remote');
  assert.equal(inserts[0].salary_min, 800000);
  assert.equal(inserts[0].salary_max, 1200000);
  assert.equal(inserts[0].currency, 'INR');
  assert.equal(inserts[0].category, 'Software Development');
  assert.equal(inserts[0].experience, '3+ years');
  assert.equal(inserts[0].education, "Bachelor's Degree");
  assert.equal(inserts[0].application_link, 'https://example.com/apply');
  assert.equal(inserts[0].posted_by, '8553ef54-e14f-4f83-aca8-e017702a6fad');
  assert.equal(inserts[0].status, 'published');
});

test('publishPendingJobs skips duplicate application links and marks processed items published', async () => {
  const updates = [];

  const mockSupabase = {
    from(table) {
      if (table === 'processed_jobs') {
        return {
          select() {
            return createQueryResult([{ 
              id: 'processed-2',
              title: 'Frontend Engineer',
              company_id: 'company-2',
              location: null,
              employment_type: 'Part Time',
              work_mode: 'Hybrid',
              salary: null,
              currency: null,
              experience: null,
              description: 'UI work',
              skills: null,
              apply_url: 'https://example.com/dup',
              expiry_date: null,
              status: 'active',
              is_active: true,
              published: false,
              retry_count: 0,
            }]);
          },
          update(payload) {
            updates.push({ table, payload });
            return {
              eq() {
                return { data: null, error: null };
              },
            };
          },
        };
      }

      if (table === 'companies') {
        return {
          select() {
            return createQueryResult({ id: 'company-2', name: 'Google', logo_url: null });
          },
        };
      }

      if (table === 'jobs') {
        return {
          select() {
            return createQueryResult({ id: 'existing-job' });
          },
          insert() {
            throw new Error('insert should not be called');
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await publishPendingJobs({ supabase: mockSupabase, logger: createLogger() });

  assert.equal(result.publishedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.published, true);
});
