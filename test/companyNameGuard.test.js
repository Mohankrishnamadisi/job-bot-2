const test = require('node:test');
const assert = require('node:assert/strict');
const { fillMissingFields } = require('../src/ai/jobExtractor');

test('fillMissingFields does not write Confidential Company for unknown source data', () => {
  const result = fillMissingFields({
    title: 'Senior Software Engineer',
    company: null,
    source: 'Microsoft',
    location: null,
    description: 'Build and ship scalable cloud services.',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    summary: null,
    skills: null,
    responsibilities: null,
    benefits: null,
  }, {});

  assert.notEqual(result.company, 'Confidential Company');
  assert.equal(result.company, 'Microsoft');
});

test('fillMissingFields accepts the project-supported companies', () => {
  for (const company of ['Amazon', 'Microsoft', 'Wipro', 'Cognizant', 'Capgemini', 'Infosys', 'HCLTech', 'TCS']) {
    const result = fillMissingFields({
      title: 'Senior Software Engineer',
      company: null,
      source: company,
      location: null,
      description: 'Build and ship scalable cloud services.',
      experience: null,
      employment_type: null,
      work_mode: null,
      salary: null,
      summary: null,
      skills: null,
      responsibilities: null,
      benefits: null,
    }, {});

    assert.equal(result.company, company);
  }
});
