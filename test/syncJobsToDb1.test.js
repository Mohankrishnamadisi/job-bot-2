const test = require('node:test');
const assert = require('node:assert/strict');

const { syncJobsToDb1 } = require('../src/sync/syncJobsToDb1');
const { createDb1Client } = require('../src/database/db1Client');

const SYSTEM_USER_ID = '0443dc8c-136c-4a83-b484-28435d9025b0';

function createLogger() {
  return { info() {}, warn() {}, error() {} };
}

function createQuery(resolveResult) {
  const query = {
    filters: {},
    select() { return this; },
    range(start, end) { this.filters.range = [start, end]; return this; },
    eq(field, value) { this.filters[field] = value; return this; },
    in(field, values) { this.filters[field] = values; return this; },
    insert(payload) { this.action = 'insert'; this.payload = payload; return this; },
    update(payload) { this.action = 'update'; this.payload = payload; return this; },
    then(resolve, reject) {
      return Promise.resolve().then(() => resolveResult(this)).then(resolve, reject);
    },
  };
  return query;
}

function createDb2(jobs) {
  return {
    from(table) {
      assert.equal(table, 'jobs');
      return createQuery((query) => {
        const [start, end] = query.filters.range;
        return { data: jobs.slice(start, end + 1), error: null };
      });
    },
  };
}

function createDb1(initialJobs = [], failedInsertLinks = []) {
  const rows = initialJobs.map((job) => ({ ...job }));
  const requests = [];
  return {
    rows,
    requests,
    client: {
      from(table) {
        assert.equal(table, 'jobs');
        return createQuery((query) => {
          requests.push({ action: query.action || 'select', filters: query.filters, payload: query.payload });
          if (query.action === 'insert') {
            const payloads = Array.isArray(query.payload) ? query.payload : [query.payload];
            if (payloads.some((job) => failedInsertLinks.includes(job.application_link))) {
              return { data: null, error: new Error('simulated insert failure') };
            }
            const newRows = (Array.isArray(query.payload) ? query.payload : [query.payload])
              .map((job, index) => ({ ...job, id: `inserted-${rows.length}-${index}`, applications_count: 0 }));
            rows.push(...newRows);
            return { data: newRows, error: null };
          }
          if (query.action === 'update') {
            const row = rows.find((candidate) => candidate.id === query.filters.id);
            if (row) Object.assign(row, query.payload);
            return { data: row ? [row] : [], error: null };
          }
          const filtered = rows.filter((row) => (
            row.posted_by === query.filters.posted_by
            && query.filters.application_link.includes(row.application_link)
          ));
          return { data: filtered.map(({ id, posted_by, application_link }) => ({ id, posted_by, application_link })), error: null };
        });
      },
    },
  };
}

function sourceJob(overrides = {}) {
  return {
    title: 'Platform Engineer',
    company_name: 'Example Co',
    company_logo_url: 'https://example.com/logo.png',
    location: 'Remote',
    job_type: 'Full-Time',
    salary_min: 100000,
    salary_max: 150000,
    experience: '3+ years',
    description: 'Build systems',
    skills: ['Node.js'],
    application_link: 'https://example.com/apply',
    posted_by: SYSTEM_USER_ID,
    featured: false,
    status: 'published',
    category: 'Engineering',
    education: 'Bachelors',
    application_deadline: '2026-12-31',
    currency: 'USD',
    work_mode: 'Remote',
    positions_available: 1,
    screening_questions: [],
    ...overrides,
  };
}

async function sync(db2Jobs, db1State = createDb1()) {
  return syncJobsToDb1({
    db2: createDb2(db2Jobs),
    db1: db1State.client,
    logger: createLogger(),
    batchSize: 2,
  });
}

test('sync inserts a new final DB2 job and forwards posted_by without DB2 metadata', async () => {
  const db1 = createDb1();
  const result = await sync([sourceJob()], db1);

  assert.equal(result.insertedCount, 1);
  assert.equal(db1.rows.length, 1);
  assert.equal(db1.rows[0].posted_by, SYSTEM_USER_ID);
  assert.equal(db1.rows[0].title, 'Platform Engineer');
  assert.equal(db1.rows[0].applications_count, 0);
  assert.equal('id' in db1.rows[0], true);
  assert.equal(db1.requests.filter((request) => request.action === 'insert').length, 1);
});

test('sync updates an existing scraper job without duplicating it or overwriting applications_count', async () => {
  const db1 = createDb1([{
    id: 'existing-job',
    posted_by: SYSTEM_USER_ID,
    application_link: 'https://example.com/apply',
    title: 'Old title',
    applications_count: 17,
  }]);

  const result = await sync([sourceJob({ title: 'Updated title' })], db1);

  assert.equal(result.updatedCount, 1);
  assert.equal(db1.rows.length, 1);
  assert.equal(db1.rows[0].title, 'Updated title');
  assert.equal(db1.rows[0].applications_count, 17);
});

test('same application link under a recruiter posted_by inserts scraper job without changing recruiter job', async () => {
  const recruiterJob = {
    id: 'recruiter-job',
    posted_by: '00000000-0000-0000-0000-000000000001',
    application_link: 'https://example.com/apply',
    title: 'Recruiter title',
    applications_count: 8,
  };
  const db1 = createDb1([recruiterJob]);

  const result = await sync([sourceJob()], db1);

  assert.equal(result.insertedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(db1.rows.length, 2);
  assert.equal(db1.rows[0].title, 'Recruiter title');
  assert.equal(db1.rows[1].posted_by, SYSTEM_USER_ID);
});

test('closed DB2 status is synchronized and missing application links are skipped', async () => {
  const db1 = createDb1([{
    id: 'existing-job',
    posted_by: SYSTEM_USER_ID,
    application_link: 'https://example.com/apply',
    title: 'Open title',
    applications_count: 2,
  }]);

  const result = await sync([
    sourceJob({ status: 'closed' }),
    sourceJob({ application_link: null, title: 'No link' }),
  ], db1);

  assert.equal(result.updatedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(db1.rows[0].status, 'closed');
  assert.equal(db1.rows.length, 1);
});

test('missing DB1 credentials fail with a clear configuration error', async () => {
  const missingClient = createDb1Client({ url: '', serviceRoleKey: '' });
  assert.throws(
    () => missingClient.from('jobs'),
    /Set DB1_SUPABASE_URL and DB1_SUPABASE_SERVICE_ROLE_KEY/
  );

  await assert.rejects(
    syncJobsToDb1({
      db2: createDb2([sourceJob()]),
      db1: missingClient,
      logger: createLogger(),
    }),
    /Set DB1_SUPABASE_URL and DB1_SUPABASE_SERVICE_ROLE_KEY/
  );
});

test('DB1 client uses the ws transport for Supabase Realtime', () => {
  let receivedOptions;
  const createClient = (url, serviceRoleKey, options) => {
    receivedOptions = { url, serviceRoleKey, options };
    return {};
  };

  createDb1Client({
    url: 'https://db1.example.com',
    serviceRoleKey: 'service-role-key',
    createClient,
  });

  assert.equal(receivedOptions.url, 'https://db1.example.com');
  assert.equal(receivedOptions.serviceRoleKey, 'service-role-key');
  assert.equal(receivedOptions.options.realtime.transport, require('ws'));
});

test('an individual DB1 insert failure does not block other jobs in the batch', async () => {
  const db1 = createDb1([], ['https://example.com/fails']);
  const result = await sync([
    sourceJob({ application_link: 'https://example.com/fails' }),
    sourceJob({ application_link: 'https://example.com/succeeds' }),
  ], db1);

  assert.equal(result.errorCount, 1);
  assert.equal(result.insertedCount, 1);
  assert.equal(db1.rows.length, 1);
  assert.equal(db1.rows[0].application_link, 'https://example.com/succeeds');
});
