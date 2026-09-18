const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const axios = require('axios');

const serviceModulePath = require.resolve('../src/services/fetchInfosysJobs');
const jobRepositoryPath = require.resolve('../src/database/jobRepository');
const duplicateServicePath = require.resolve('../src/services/duplicateService');

function clearModuleCache() {
  delete require.cache[serviceModulePath];
  delete require.cache[jobRepositoryPath];
  delete require.cache[duplicateServicePath];
}

const infosysConfig = require('../src/config/infosys');
const { normalizeInfosysJob } = require('../src/services/fetchInfosysJobs');

test('normalizeInfosysJob converts gateway payload into the expected job shape', () => {
  const rawJob = {
    postingTitle: 'GenAI Developer',
    location: 'BANGALORE',
    postingDescription: 'Build enterprise AI products',
    rolesResponsibilities: 'Develop GenAI features for clients',
    postingId: 247593,
    requisitionId: 249477,
    referenceCode: 'INFSYS-EXTERNAL-249477',
    minExperienceLevel: 3,
    maxExperienceLevel: 6,
    skills: 'Node.js, Python',
    preferredSkills: 'LLM, RAG',
  };

  const normalized = normalizeInfosysJob(rawJob, 'Infosys');

  assert.ok(normalized);
  assert.equal(normalized.title, 'GenAI Developer');
  assert.equal(normalized.company_name, 'Infosys');
  assert.equal(normalized.company, 'Infosys');
  assert.equal(normalized.location, 'BANGALORE');
  assert.equal(normalized.experience, '3-6 years');
  assert.match(normalized.description, /GenAI/);
  assert.equal(normalized.source, 'infosys');
  assert.equal(normalized.external_job_id, '247593');
  assert.equal(normalized.apply_url, 'https://career.infosys.com/jobdesc?jobReferenceCode=INFSYS-EXTERNAL-249477');
  assert.equal(normalized.applyUrl, 'https://career.infosys.com/jobdesc?jobReferenceCode=INFSYS-EXTERNAL-249477');
});

test('normalizeInfosysJob builds a unique Infosys detail URL from referenceCode', () => {
  const normalized = normalizeInfosysJob({
    postingId: 250590,
    referenceCode: 'INFSYS-EXTERNAL-252486',
    postingTitle: 'Gen AI Architect',
    location: 'BANGALORE',
  }, 'Infosys');

  assert.equal(normalized.apply_url, 'https://career.infosys.com/jobdesc?jobReferenceCode=INFSYS-EXTERNAL-252486');
});

test('fetchInfosysJobs deduplicates repeated pages and returns unique normalized jobs', async () => {
  clearModuleCache();

  const originalAxiosGet = axios.get;
  const originalPageSize = infosysConfig.PAGE_SIZE;

  infosysConfig.PAGE_SIZE = 1;
  axios.get = async (url, config) => {
    const pageNumber = config?.params?.pageNumber;
    const jobs = pageNumber === 1
      ? [{ postingId: 1001, postingTitle: 'First Job', location: 'Bangalore' }]
      : [{ postingId: 1001, postingTitle: 'Duplicate Job', location: 'Bangalore' }];

    return { status: 200, data: jobs };
  };

  require.cache[duplicateServicePath] = {
    id: duplicateServicePath,
    filename: duplicateServicePath,
    loaded: true,
    exports: {
      deduplicateJobs: async (jobs) => ({ uniqueJobs: jobs, duplicateCount: 0 }),
    },
  };

  try {
    const { fetchInfosysJobs } = require('../src/services/fetchInfosysJobs');
    const stats = await fetchInfosysJobs();

    assert.equal(stats.fetched, 2);
    assert.equal(stats.normalized, 1);
    assert.equal(stats.unique, 1);
    assert.equal(Array.isArray(stats.jobs), true);
    assert.equal(stats.jobs.length, 1);
    assert.equal(stats.jobs[0].title, 'First Job');
  } finally {
    axios.get = originalAxiosGet;
    infosysConfig.PAGE_SIZE = originalPageSize;
    clearModuleCache();
  }
});
