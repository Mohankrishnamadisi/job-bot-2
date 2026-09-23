const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeJob } = require('../src/scrapers/persistent');

test('normalizeJob builds a Persistent Systems job record', () => {
  const result = normalizeJob({
    _source: {
      newJobCode: '106803',
      jobTitle: 'Snowflake Data Engineer',
      locationDisplayForManageJobs: 'Pune, Maharashtra, India',
      jobUrl: 'snowflake-data-engineer-pune-202410161515494',
      createdDate: 1729067506000,
      desiredSkillList: ['', 'Snowflake'],
    },
  });

  assert.equal(result.source, 'Persistent Systems');
  assert.equal(result.company, 'Persistent Systems');
  assert.equal(result.positionId, '106803');
  assert.equal(result.country, 'India');
  assert.equal(result.apply_url, 'https://careers.persistent.com/jobview/snowflake-data-engineer-pune-202410161515494');
  assert.deepEqual(result.skills, ['Snowflake']);
});