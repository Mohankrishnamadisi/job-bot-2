const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHclJob, fetchHclJobsPage, importHclJobs } = require('../src/services/jobs/fetchHclJobs');

test('normalizeHclJob maps HCL payload fields into the shared job shape', () => {
  const normalized = normalizeHclJob(
    {
      response: {
        unifiedStandardTitle: 'Senior Platform Engineer',
        custprimecity: 'Pune',
        custCountryRegion: ['India'],
        employmentType: 'Full Time',
        jobDescription: '<p>Build products</p>',
        id: '123',
        postedDate: '2026-01-10T12:00:00Z',
      },
    },
    'HCLTech'
  );

  assert.equal(normalized.title, 'Senior Platform Engineer');
  assert.equal(normalized.company_name, 'HCLTech');
  assert.equal(normalized.location, 'Pune, India');
  assert.equal(normalized.employment_type, 'Full Time');
  assert.equal(normalized.apply_url, 'https://careers.hcltech.com/go/NonTPDemand/9558355/Senior%20Platform%20Engineer/123');
  assert.equal(normalized.external_job_id, '123');
  assert.equal(normalized.source, 'hcltech');
});

test('fetchHclJobsPage reads jobSearchResult and totalJobs from the API response', async () => {
  const result = await fetchHclJobsPage(1, {
    axiosClient: {
      post: async () => ({
        status: 200,
        data: {
          jobSearchResult: [
            {
              response: {
                id: '1001',
                unifiedStandardTitle: 'Developer',
                custprimecity: 'Noida',
                custCountryRegion: ['India'],
              },
            },
          ],
          totalJobs: 1,
        },
      }),
    },
  });

  assert.equal(result.totalJobs, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].response.id, '1001');
});

test('importHclJobs returns deduplicated unique jobs and skips duplicates', async () => {
  const result = await importHclJobs({
    axiosClient: {
      post: async () => ({
        status: 200,
        data: {
          jobSearchResult: [
            {
              response: {
                id: '2001',
                unifiedStandardTitle: 'Engineer',
                custprimecity: 'Hyderabad',
                custCountryRegion: ['India'],
              },
            },
            {
              response: {
                id: '2002',
                unifiedStandardTitle: 'Analyst',
                custprimecity: 'Bengaluru',
                custCountryRegion: ['India'],
              },
            },
          ],
          totalJobs: 2,
        },
      }),
    },
    deduplicateJobsFn: async (jobs) => ({
      uniqueJobs: jobs.slice(0, 1),
      duplicateJobs: [{ reason: 'duplicate' }],
      duplicateCount: 1,
    }),
    ensureCompanyFn: async () => ({ id: 'company-1' }),
  });

  assert.equal(result.total_fetched, 2);
  assert.equal(result.total_normalized, 2);
  assert.equal(result.total_unique, 1);
  assert.equal(result.total_duplicates, 1);
  assert.equal(result.total_skipped, 0);
});
