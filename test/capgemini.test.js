const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJob, fetchAllSearchJobs } = require('../src/scrapers/capgemini');

test('normalizeJob builds a Capgemini job record with a stable apply URL', () => {
  const result = normalizeJob({
    title: 'Senior Software Engineer',
    href: 'https://www.capgemini.com/job/senior-software-engineer/',
    location: 'Hyderabad, India',
    description: 'Design and deliver enterprise software solutions.',
  });

  assert.equal(result.title, 'Senior Software Engineer');
  assert.equal(result.source, 'Capgemini');
  assert.equal(result.company, 'Capgemini');
  assert.equal(result.location, 'Hyderabad, India');
  assert.equal(result.apply_url, 'https://www.capgemini.com/job/senior-software-engineer/');
  assert.equal(result.status, 'open');
  assert.equal(result.is_active, true);
});

test('Capgemini returns page 1 jobs when page 2 times out', async () => {
  const pageOne = [{ title: 'Engineer', href: '/in-en/jobs/1', posted_date: null }];
  const fetchPage = async (page) => {
    if (page === 1) return { data: pageOne, error: null };
    throw new Error('page timeout');
  };

  const result = await fetchAllSearchJobs(false, new AbortController().signal, fetchPage);

  assert.equal(result.pageCount, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.allJobs.length, 1);
  assert.equal(result.allJobs[0].title, 'Engineer');
  assert.equal(result.stopReason, 'page failed');
});
