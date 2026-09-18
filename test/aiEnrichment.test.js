const test = require('node:test');
const assert = require('node:assert/strict');

const { parseEnrichmentResponse } = require('../src/ai/responseParser');
const { createJobEnricher } = require('../src/ai');
const { mergeEnrichment } = require('../src/ai/jobExtractor');

test('parseEnrichmentResponse extracts JSON from fenced output', () => {
  const raw = 'Here is the result:\n```json\n{"title":"Senior Engineer","location":"Remote","experience":"3+ years"}\n```';

  const parsed = parseEnrichmentResponse(raw);

  assert.deepEqual(parsed, {
    title: 'Senior Engineer',
    location: 'Remote',
    experience: '3+ years',
  });
});

test('parseEnrichmentResponse recovers malformed JSON with unescaped newlines and trailing commas', () => {
  const raw = '{"title":"Senior\nEngineer","location":"Remote",,"experience":"3+ years",}';

  const parsed = parseEnrichmentResponse(raw);

  assert.deepEqual(parsed, {
    title: 'Senior\nEngineer',
    location: 'Remote',
    experience: '3+ years',
  });
});

test('createJobEnricher retries AI provider once after a transient initial failure', async () => {
  const calls = [];
  const enrichJob = createJobEnricher({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    ollamaClient: async (prompt) => {
      if (calls.length === 0) {
        calls.push('first');
        throw new Error('transient AI failure');
      }
      calls.push('second');
      return '{"title":"Senior Engineer","location":"Remote","experience":"3+ years","employment_type":"Full Time","work_mode":"Hybrid","salary":"Competitive Salary","summary":"Build reliable systems.","skills":["Node.js","PostgreSQL"],"description":"A strong professional description.","responsibilities":["Write code","Collaborate with team","Deliver results"],"benefits":["Flexible hours","Career growth"]}';
    },
  });

  const job = await enrichJob({
    title: 'Engineer',
    description: null,
    location: null,
    salary: null,
    experience: null,
    employment_type: null,
    work_mode: null,
    summary: null,
    skills: [],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'first');
  assert.equal(calls[1], 'second');
  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.location, 'Remote');
  assert.equal(job.experience, '3+ years');
  assert.equal(job.employment_type, 'Full Time');
});

test('createJobEnricher preserves existing values and only fills missing ones', async () => {
  const calls = [];
  const enrichJob = createJobEnricher({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    ollamaClient: async (prompt) => {
      calls.push(prompt);
      return {
        title: 'Senior Engineer',
        location: null,
        experience: null,
        employment_type: 'Full Time',
        work_mode: 'Remote',
        salary: null,
        summary: 'Build reliable systems.',
        skills: ['Node.js', 'PostgreSQL'],
      };
    },
  });

  const job = await enrichJob({
    title: 'Engineer',
    description: 'Build software',
    location: 'New York',
    salary: '$120k',
    experience: null,
    employment_type: null,
    work_mode: null,
    summary: null,
    skills: [],
  });

  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.location, 'New York');
  assert.equal(job.salary, '$120k');
  assert.equal(job.experience, 'Any Experience');
  assert.equal(job.employment_type, 'Full Time');
  assert.equal(job.work_mode, 'Remote');
  assert.equal(job.summary, 'Build reliable systems.');
  assert.deepEqual(job.skills, ['Node.js', 'PostgreSQL']);
  assert.ok(Array.isArray(job.responsibilities));
  assert.ok(Array.isArray(job.benefits));
  assert.equal(calls.length, 1);
});

test('mergeEnrichment generates professional defaults when the source data is weak', () => {
  const result = mergeEnrichment({
    title: 'React Developer',
    company: 'Acme Labs',
    location: 'New York',
    description: '   ',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    summary: null,
    skills: [],
  }, {});

  assert.ok(result.description && result.description.length > 50);
  assert.ok(result.summary && result.summary.length > 20);
  assert.deepEqual(result.skills, ['React', 'TypeScript', 'Redux', 'REST API', 'HTML', 'CSS', 'JavaScript']);
  assert.equal(result.experience, 'Any Experience');
  assert.equal(result.salary, 'Competitive Salary');
  assert.equal(result.employment_type, 'Full Time');
  assert.equal(result.work_mode, 'On-site');
  assert.ok(Array.isArray(result.responsibilities));
  assert.ok(result.responsibilities.length >= 3);
  assert.ok(Array.isArray(result.benefits));
  assert.ok(result.benefits.length >= 4);
});

test('mergeEnrichment uses Confidential Company when company is missing', () => {
  const result = mergeEnrichment({
    title: 'React Developer',
    company: null,
    location: 'Remote',
    description: '   ',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    summary: null,
    skills: [],
  }, {});

  assert.equal(result.company, 'Confidential Company');
});

test('mergeEnrichment uses Location Not Specified when location is missing', () => {
  const result = mergeEnrichment({
    title: 'React Developer',
    company: 'Acme Labs',
    location: null,
    description: '   ',
    experience: null,
    employment_type: null,
    work_mode: null,
    salary: null,
    summary: null,
    skills: [],
  }, {});

  assert.equal(result.location, 'Location Not Specified');
});

test('createJobEnricher skips AI work when the core enrichment fields already exist', async () => {
  const enrichJob = createJobEnricher({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    ollamaClient: async () => {
      throw new Error('should not be called');
    },
  });

  const result = await enrichJob({
    title: 'Engineer',
    description: 'A well-written, detailed job description for an experienced engineer role that covers responsibilities, team context, and delivery expectations in a meaningful way so the enrichment layer can preserve it as-is.',
    location: 'Remote',
    salary: '$120k',
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    summary: 'Build software',
    skills: ['Node.js'],
  });

  assert.equal(result.title, 'Engineer');
  assert.ok(result.description && result.description.length > 80);
  assert.equal(result.location, 'Remote');
  assert.equal(result.salary, '$120k');
  assert.equal(result.experience, '3+ years');
  assert.equal(result.employment_type, 'Full Time');
  assert.equal(result.work_mode, 'Remote');
  assert.equal(result.summary, 'Build software');
  assert.deepEqual(result.skills, ['Node.js']);
  assert.ok(Array.isArray(result.responsibilities));
  assert.ok(Array.isArray(result.benefits));
});

test('mergeEnrichment uses the AI title as the primary processed title', () => {
  const result = mergeEnrichment({
    title: 'SLT HDFC BB Bangalore',
    company: 'Acme Bank',
    location: 'Bangalore',
    description: 'We are looking for a banking operations specialist.',
    experience: '2+ years',
    employment_type: 'Full Time',
    work_mode: 'On-site',
    salary: null,
    summary: 'Handle banking operations.',
    skills: ['Operations', 'Customer Support'],
    responsibilities: ['Support banking processes'],
    benefits: ['Growth opportunities'],
  }, {
    title: 'Banking Operations Executive',
    description: 'We are seeking a banking operations executive to support customers and maintain operational excellence.',
  });

  assert.equal(result.title, 'Banking Operations Executive');
  assert.notEqual(result.title, 'SLT HDFC BB Bangalore');
});

test('mergeEnrichment prefers AI descriptions over the raw source description', () => {
  const result = mergeEnrichment({
    title: 'React Developer',
    company: 'Acme Labs',
    location: 'Remote',
    description: 'We are looking for a React developer with 3 years experience.',
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['React', 'JavaScript'],
    responsibilities: ['Build UI components'],
    benefits: ['Growth opportunities'],
  }, {
    description: 'We are seeking a skilled React Developer to join our engineering team and deliver modern, scalable web experiences for customers across the business.',
  });

  assert.equal(result.description, 'We are seeking a skilled React Developer to join our engineering team and deliver modern, scalable web experiences for customers across the business.');
  assert.notEqual(result.description, 'We are looking for a React developer with 3 years experience.');
});

test('mergeEnrichment uses the template fallback only when AI description is unavailable', () => {
  const result = mergeEnrichment({
    title: 'Backend Engineer',
    company: 'Globex',
    location: 'Remote',
    description: 'Need engineer.',
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['Node.js', 'PostgreSQL'],
    responsibilities: ['Build APIs'],
    benefits: ['Remote-first culture'],
  }, {});

  assert.ok(result.description.includes('Backend Engineer'));
  assert.ok(result.description.length > 80);
});

test('mergeEnrichment rejects copied raw descriptions and rewrites them', () => {
  const rawDescription = 'We are looking for a React developer with 3 years experience. Build web apps.';
  const result = mergeEnrichment({
    title: 'React Developer',
    company: 'Acme Labs',
    location: 'Remote',
    description: rawDescription,
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['React', 'JavaScript'],
    responsibilities: ['Build UI components'],
    benefits: ['Growth opportunities'],
  }, {
    description: rawDescription,
  });

  assert.notEqual(result.description, rawDescription);
  assert.ok(result.description.includes('React'));
});

test('mergeEnrichment rewrites HTML descriptions into a clean professional description', () => {
  const result = mergeEnrichment({
    title: 'React Developer',
    company: 'Acme Labs',
    location: 'Remote',
    description: '<p>We are looking for a React developer with 3 years experience.</p><p>Build web apps.</p>',
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['React', 'JavaScript'],
    responsibilities: ['Build UI components'],
    benefits: ['Growth opportunities'],
  }, {
    description: '<p>We are seeking a skilled React Developer to join our engineering team and deliver modern, scalable web experiences for customers.</p>',
  });

  assert.ok(result.description.includes('React'));
  assert.ok(result.description.length > 120);
  assert.ok(!result.description.includes('<p>'));
  assert.ok(!result.description.includes('http'));
});

test('mergeEnrichment expands short descriptions when AI provides a fuller rewrite', () => {
  const result = mergeEnrichment({
    title: 'Data Engineer',
    company: 'Northwind',
    location: 'Hybrid',
    description: 'Need engineer.',
    experience: '2+ years',
    employment_type: 'Full Time',
    work_mode: 'Hybrid',
    salary: null,
    summary: null,
    skills: ['SQL', 'Python'],
    responsibilities: ['Build pipelines'],
    benefits: ['Learning budget'],
  }, {
    description: 'We are seeking a Data Engineer to design and maintain robust data pipelines, support analytics initiatives, and help the business make confident decisions with accurate, trusted information.',
  });

  assert.ok(result.description.length > 140);
  assert.ok(result.description.includes('Data Engineer'));
});

test('mergeEnrichment expands very short descriptions into a fuller professional description', () => {
  const result = mergeEnrichment({
    title: 'Data Engineer',
    company: 'Northwind',
    location: 'Hybrid',
    description: 'Need engineer.',
    experience: '2+ years',
    employment_type: 'Full Time',
    work_mode: 'Hybrid',
    salary: null,
    summary: null,
    skills: ['SQL', 'Python'],
    responsibilities: ['Build pipelines'],
    benefits: ['Learning budget'],
  }, {});

  assert.ok(result.description.length > 160);
  assert.notEqual(result.description.toLowerCase(), 'need engineer.');
});

test('mergeEnrichment generates a new description when the source description is missing', () => {
  const result = mergeEnrichment({
    title: 'Backend Engineer',
    company: 'Globex',
    location: 'Remote',
    description: null,
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['Node.js', 'PostgreSQL'],
    responsibilities: ['Build APIs'],
    benefits: ['Remote-first culture'],
  }, {});

  assert.ok(result.description.length > 140);
  assert.ok(!result.description.includes('null'));
});

test('mergeEnrichment replaces long copied descriptions with a fresher professional rewrite', () => {
  const longDescription = 'We are looking for a software engineer to join our team. We are looking for a software engineer to join our team. We are looking for a software engineer to join our team. We are looking for a software engineer to join our team. We are looking for a software engineer to join our team.';
  const result = mergeEnrichment({
    title: 'Software Engineer',
    company: 'Contoso',
    location: 'On-site',
    description: longDescription,
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'On-site',
    salary: null,
    summary: null,
    skills: ['JavaScript', 'Node.js'],
    responsibilities: ['Ship features'],
    benefits: ['Mentorship'],
  }, {});

  assert.ok(result.description.length > 180);
  assert.notEqual(result.description, longDescription);
  assert.ok(!result.description.includes('We are looking for a software engineer'));
});

test('mergeEnrichment rewrites corrupted descriptions into a clean professional description', () => {
  const result = mergeEnrichment({
    title: 'QA Engineer',
    company: 'Fabrikam',
    location: 'Remote',
    description: 'Corrupted description [object Object] null undefined',
    experience: '1+ years',
    employment_type: 'Full Time',
    work_mode: 'Remote',
    salary: null,
    summary: null,
    skills: ['Playwright', 'Selenium'],
    responsibilities: ['Write tests'],
    benefits: ['Flexible work'],
  }, {});

  assert.ok(result.description.length > 140);
  assert.ok(!result.description.includes('[object Object]'));
  assert.ok(!result.description.includes('undefined'));
});

test('mergeEnrichment removes duplicate paragraphs from generated descriptions', () => {
  const result = mergeEnrichment({
    title: 'Product Designer',
    company: 'Wayne Enterprises',
    location: 'Hybrid',
    description: 'We design products.\n\nWe design products.',
    experience: '3+ years',
    employment_type: 'Full Time',
    work_mode: 'Hybrid',
    salary: null,
    summary: null,
    skills: ['Figma', 'Design Systems'],
    responsibilities: ['Design experiences'],
    benefits: ['Creative freedom'],
  }, {
    description: 'We are seeking a Product Designer to shape thoughtful, user-centered experiences and collaborate closely with product and engineering teams to deliver polished digital products.',
  });

  assert.ok(result.description.length > 80);
  assert.ok(!result.description.toLowerCase().includes('we design products'));
  assert.ok(!result.description.toLowerCase().includes('we design products.\n\nwe design products.'));
});
