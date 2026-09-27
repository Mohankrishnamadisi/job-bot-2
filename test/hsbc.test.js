const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, normalizeJob, fetchAllSearchJobs } = require('../src/scrapers/hsbc');
const { getRegisteredScraperKeys } = require('../src/scrapers');

test('HSBC scraper is registered for company-key runs', () => {
  assert.ok(getRegisteredScraperKeys().includes('hsbc'));
});

test('HSBC normalizer creates a valid job record from an API position', () => {
  const result = normalizeJob({
    id: 563774612138087,
    posting_name: 'Senior Database Engineer',
    location: 'Pune, Maharashtra, India',
    department: 'Technology',
    canonicalPositionUrl: 'https://portal.careers.hsbc.com/careers/job/563774612138087',
    t_create: 1787146382,
    work_location_option: 'hybrid',
  });

  assert.equal(result.positionId, 563774612138087);
  assert.equal(result.title, 'Senior Database Engineer');
  assert.equal(result.source, 'HSBC');
  assert.equal(result.company, 'HSBC');
  assert.equal(result.location, 'Pune, Maharashtra, India');
  assert.equal(result.department, 'Technology');
  assert.equal(result.work_mode, 'hybrid');
  assert.equal(result.apply_url, 'https://portal.careers.hsbc.com/careers/job/563774612138087');
  assert.equal(result.posted_date, new Date(1787146382 * 1000).toISOString());
  assert.equal(result.status, 'open');
  assert.equal(result.is_active, true);
});

test('HSBC search URL encodes the listing page parameters', () => {
  const url = new URL(buildSearchUrl(20, 10));

  assert.equal(url.origin, 'https://portal.careers.hsbc.com');
  assert.equal(url.pathname, '/api/apply/v2/jobs');
  assert.equal(url.searchParams.get('domain'), 'hsbc.com');
  assert.equal(url.searchParams.get('start'), '20');
  assert.equal(url.searchParams.get('num'), '10');
  assert.equal(url.searchParams.get('sort_by'), 'relevance');
});

test('HSBC fetches only up to the requested job limit across pages', async () => {
  const calls = [];
  const fetchPage = async (start, num) => {
    calls.push({ start, num });
    return {
      count: 23,
      positions: Array.from({ length: num }, (_, index) => {
        const id = start + index + 1;
        return {
          id,
          name: `HSBC Job ${id}`,
          canonicalPositionUrl: `https://portal.careers.hsbc.com/careers/job/${id}`,
        };
      }),
    };
  };

  const result = await fetchAllSearchJobs(15, null, fetchPage);

  assert.equal(result.totalCount, 23);
  assert.equal(result.jobs.length, 15);
  assert.deepEqual(calls, [{ start: 0, num: 10 }, { start: 10, num: 5 }]);
});

test('HSBC pagination advances past duplicate positions', async () => {
  const calls = [];
  const fetchPage = async (start, num) => {
    calls.push({ start, num });
    const ids = start === 0 ? [1, 1, 1] : start === 3 ? [1, 2] : [3];
    return {
      count: 12,
      positions: ids.slice(0, num).map((id) => ({
        id,
        name: `HSBC Job ${id}`,
        canonicalPositionUrl: `https://portal.careers.hsbc.com/careers/job/${id}`,
      })),
    };
  };

  const result = await fetchAllSearchJobs(3, null, fetchPage);

  assert.equal(result.jobs.length, 3);
  assert.deepEqual(calls, [{ start: 0, num: 3 }, { start: 3, num: 2 }, { start: 5, num: 1 }]);
});