'use strict';

const logger = require('../utils/logger');
const { SUPPORTED_COMPANY_NAMES } = require('../database/companyRepository');
const { buildEnrichmentPrompt } = require('./promptBuilder');
const { parseEnrichmentResponse } = require('./responseParser');
const { callOllama } = require('./ollamaClient');
const { callGroq } = require('./groqClient');

const APPROVED_COMPANIES = new Set(SUPPORTED_COMPANY_NAMES);

function hasMeaningfulValue(value) {
  if (value == null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => String(entry).trim() !== '');
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return true;
}

function normalizeCompanyName(value) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/[^a-zA-Z0-9\s&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  const directMatch = [...APPROVED_COMPANIES].find((company) => company.toLowerCase() === normalized.toLowerCase());
  if (directMatch) {
    return directMatch;
  }

  const containsMatch = [...APPROVED_COMPANIES].find((company) => normalized.toLowerCase().includes(company.toLowerCase()));
  if (containsMatch) {
    return containsMatch;
  }

  return null;
}

function stripNoiseFromDescription(description) {
  if (!hasMeaningfulValue(description)) {
    return '';
  }

  let text = String(description).trim();
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, ' and ');
  text = text.replace(/&#x?[a-f0-9]+/gi, ' ');
  text = text.replace(/\bhttps?:\/\/\S+/gi, ' ');
  text = text.replace(/\bwww\.\S+/gi, ' ');
  text = text.replace(/\{[^{}]*\}/g, ' ');
  text = text.replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/\b(?:json|html|array|object|number|undefined|null|true|false)\b/gi, ' ');
  text = text.replace(/\b\d{1,3}\b/g, ' ');
  text = text.replace(/([.!?])\s+/g, '$1 ');
  text = text.replace(/\s+/g, ' ').trim();

  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*\d.\s]+/, '').trim())
    .filter((line) => line.length > 0);

  const cleanedLines = [];
  const seen = new Set();
  lines.forEach((line) => {
    const normalizedLine = line.toLowerCase();
    if (seen.has(normalizedLine)) {
      return;
    }
    seen.add(normalizedLine);
    cleanedLines.push(line);
  });

  return cleanedLines.join(' ').trim();
}

function isPoorDescription(description) {
  const cleaned = stripNoiseFromDescription(description);
  if (!cleaned) {
    return true;
  }

  const text = cleaned.trim();
  if (text.length < 150) {
    return true;
  }

  const lowercase = text.toLowerCase();
  const garbageSignals = ['lorem ipsum', 'todo', 'coming soon', 'tbd', 'javascript object', 'json', 'array', 'object', 'metadata', 'job description', 'company and benefits', 'posted date', 'work site', 'travel', 'employment type'];
  if (garbageSignals.some((token) => lowercase.includes(token))) {
    return true;
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return wordCount < 80;
}

function inferSkillsFromTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) {
    return ['JavaScript', 'SQL', 'Git'];
  }

  if (normalized.includes('react')) {
    return ['React', 'TypeScript', 'Redux', 'REST API', 'HTML', 'CSS', 'JavaScript'];
  }
  if (normalized.includes('python')) {
    return ['Python', 'Django', 'REST API', 'SQL', 'Git'];
  }
  if (normalized.includes('java')) {
    return ['Java', 'Spring Boot', 'Hibernate', 'REST API', 'SQL'];
  }
  if (normalized.includes('node') || normalized.includes('javascript')) {
    return ['Node.js', 'JavaScript', 'Express.js', 'REST API', 'Git'];
  }
  if (normalized.includes('dotnet') || normalized.includes('c#') || normalized.includes('csharp')) {
    return ['.NET', 'C#', 'ASP.NET', 'SQL', 'Git'];
  }
  if (normalized.includes('devops') || normalized.includes('sre') || normalized.includes('cloud')) {
    return ['Linux', 'Docker', 'Kubernetes', 'AWS', 'CI/CD'];
  }
  if (normalized.includes('data engineer') || normalized.includes('analytics engineer')) {
    return ['Python', 'SQL', 'ETL', 'Spark', 'Airflow'];
  }
  if (normalized.includes('qa') || normalized.includes('quality assurance') || normalized.includes('test')) {
    return ['Automation Testing', 'Selenium', 'Playwright', 'Cypress', 'Git'];
  }
  if (normalized.includes('sales')) {
    return ['Salesforce', 'CRM', 'Lead Generation', 'Pipeline Management', 'Negotiation'];
  }
  if (normalized.includes('design') || normalized.includes('ui') || normalized.includes('ux')) {
    return ['Figma', 'UI Design', 'UX Design', 'Design Systems', 'Prototyping'];
  }

  return ['JavaScript', 'SQL', 'Git'];
}

function normalizeDescriptionText(value) {
  if (!hasMeaningfulValue(value)) {
    return '';
  }

  let text = String(value).trim();
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, ' and ');
  text = text.replace(/&#x?[a-f0-9]+/gi, ' ');
  text = text.replace(/\bhttps?:\/\/\S+/gi, ' ');
  text = text.replace(/\bwww\.\S+/gi, ' ');
  text = text.replace(/\{[^{}]*\}/g, ' ');
  text = text.replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function isLowQualityDescription(value) {
  const cleaned = normalizeDescriptionText(value);
  if (!cleaned) {
    return true;
  }

  const lowercase = cleaned.toLowerCase();
  if (['lorem ipsum', 'todo', 'coming soon', 'tbd', 'javascript object', 'json', 'array', 'object', 'metadata', 'click here to apply', 'privacy policy', 'company legal disclaimers'].some((token) => lowercase.includes(token))) {
    return true;
  }

  if (cleaned.length < 20) {
    return true;
  }

  const paragraphCount = cleaned.split(/\n\n+/).filter(Boolean).length;
  const duplicateParagraphs = paragraphCount > 1 && new Set(cleaned.toLowerCase().split(/\n\n+/).filter(Boolean)).size < paragraphCount;
  return duplicateParagraphs;
}

function isCopiedDescription(candidate, source) {
  const normalizedCandidate = normalizeDescriptionText(candidate)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedSource = normalizeDescriptionText(source)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedCandidate || !normalizedSource) {
    return false;
  }

  if (normalizedCandidate === normalizedSource) {
    return true;
  }

  const candidateWords = normalizedCandidate.split(' ').filter(Boolean);
  const sourceWords = new Set(normalizedSource.split(' ').filter(Boolean));
  const overlap = candidateWords.filter((word) => sourceWords.has(word)).length;
  return candidateWords.length > 0 && overlap / candidateWords.length > 0.6;
}

function shouldUseAIDescription(description, rawDescription) {
  const cleaned = normalizeDescriptionText(description);
  if (!cleaned) {
    return false;
  }

  if (isCopiedDescription(cleaned, rawDescription)) {
    return false;
  }

  if (isLowQualityDescription(cleaned)) {
    return false;
  }

  return true;
}

function generateDescription(job) {
  const title = job?.title || 'professional role';
  const company = job?.company || 'a growing organization';
  const location = job?.location || 'a dynamic location';
  const skills = Array.isArray(job?.skills) && job.skills.length ? job.skills.slice(0, 6).join(', ') : inferSkillsFromTitle(title).slice(0, 6).join(', ');
  const responsibilities = Array.isArray(job?.responsibilities) && job.responsibilities.length
    ? job.responsibilities.slice(0, 3).join(' ')
    : 'drive execution, collaborate across teams, and deliver high-quality outcomes';
  const benefits = Array.isArray(job?.benefits) && job.benefits.length
    ? job.benefits.slice(0, 2).join(' and ')
    : 'growth opportunities and collaborative support';
  const employmentType = hasMeaningfulValue(job?.employment_type) ? job.employment_type : 'Full Time';
  const workMode = hasMeaningfulValue(job?.work_mode) ? job.work_mode : 'On-site';
  const experience = hasMeaningfulValue(job?.experience) ? job.experience : 'relevant experience';
  const education = hasMeaningfulValue(job?.education) ? job.education : 'a relevant academic background';
  const roleTitle = String(title).trim();

  const paragraph1 = `We are hiring a ${roleTitle} to join ${company} in ${location}. This ${employmentType.toLowerCase()} position is designed for professionals with ${experience.toLowerCase()} who are ready to contribute to high-impact projects and help deliver reliable, well-engineered outcomes.`;
  const paragraph2 = `The successful candidate will ${responsibilities.toLowerCase()}, work closely with cross-functional teams, and bring a structured approach to problem solving, execution, and continuous improvement. The role requires strong ownership, clear communication, and the ability to adapt quickly in a fast-paced environment.`;
  const paragraph3 = `Candidates should demonstrate practical experience with ${skills} and a strong understanding of modern delivery practices. A background aligned with ${education.toLowerCase()} is preferred, along with the curiosity and discipline to learn, build, and improve as the business evolves.`;
  const paragraph4 = `We offer a collaborative workplace with ${benefits.toLowerCase()}, a ${workMode.toLowerCase()} working arrangement, and meaningful opportunities for growth, development, and long-term career progression within the organization.`;

  return [paragraph1, paragraph2, paragraph3, paragraph4].join('\n\n');
}

function generateSummary(job, description) {
  const title = job?.title || 'this role';
  const company = job?.company || 'the organization';
  const descriptionText = description || generateDescription(job);
  const cleaned = stripNoiseFromDescription(descriptionText);
  return `${title} at ${company} offers a strong opportunity for professionals who want to contribute to meaningful projects, collaborate with talented teams, and grow their expertise in a supportive environment. ${cleaned}`.slice(0, 420);
}

function generateResponsibilities(job) {
  const title = job?.title || 'this role';
  const skills = Array.isArray(job?.skills) && job.skills.length ? job.skills.slice(0, 4).join(', ') : inferSkillsFromTitle(title).slice(0, 4).join(', ');
  return [
    `Design, build, and improve high-quality solutions for ${title} initiatives`,
    `Collaborate with cross-functional teams to deliver reliable features and maintain strong technical standards`,
    `Work with modern tools and technologies such as ${skills} to support efficient delivery`,
    `Contribute to code quality, documentation, and continuous improvement across the team`,
  ];
}

function generateBenefits() {
  return [
    'Competitive compensation and growth opportunities',
    'Comprehensive health and wellness support',
    'Professional development and learning resources',
    'Flexible work arrangements and collaborative culture',
    'Paid time off and meaningful team support',
  ];
}

function inferWorkModeFromDescription(description, fallback = 'On-site') {
  const text = String(description || '').toLowerCase();
  if (text.includes('remote')) {
    return 'Remote';
  }
  if (text.includes('hybrid')) {
    return 'Hybrid';
  }
  return fallback;
}

function fillMissingFields(job, aiResponse = {}) {
  const mergedJob = { ...job };

  const fieldsToMerge = ['title', 'company', 'location', 'experience', 'employment_type', 'work_mode', 'salary', 'summary', 'skills', 'description', 'responsibilities', 'benefits'];

  fieldsToMerge.forEach((field) => {
    const existingValue = mergedJob[field];
    const aiValue = aiResponse?.[field];

    if (field !== 'description' && field !== 'title' && hasMeaningfulValue(existingValue)) {
      return;
    }

    if (field === 'company') {
      const resolvedCompany = normalizeCompanyName(aiValue || existingValue || job?.company || job?.company_name || job?.source);
      if (resolvedCompany) {
        mergedJob.company = resolvedCompany;
      } else {
        mergedJob.company = null;
      }
      return;
    }

    if (field === 'location') {
      if (hasMeaningfulValue(aiValue)) {
        mergedJob.location = aiValue;
      } else {
        mergedJob.location = 'Location Not Specified';
      }
      return;
    }

    if (field === 'skills') {
      if (Array.isArray(aiValue) && aiValue.length > 0) {
        mergedJob.skills = aiValue;
      } else if (typeof aiValue === 'string' && aiValue.trim() !== '') {
        mergedJob.skills = [aiValue.trim()];
      } else {
        mergedJob.skills = inferSkillsFromTitle(mergedJob.title);
      }
      return;
    }

    if (field === 'responsibilities') {
      if (Array.isArray(aiValue) && aiValue.length > 0) {
        mergedJob.responsibilities = aiValue;
      } else {
        mergedJob.responsibilities = generateResponsibilities(mergedJob);
      }
      return;
    }

    if (field === 'benefits') {
      if (Array.isArray(aiValue) && aiValue.length > 0) {
        mergedJob.benefits = aiValue;
      } else {
        mergedJob.benefits = generateBenefits();
      }
      return;
    }

    if (field === 'title') {
      if (hasMeaningfulValue(aiValue)) {
        mergedJob.title = String(aiValue).trim();
      } else if (!hasMeaningfulValue(mergedJob.title)) {
        mergedJob.title = String(job?.title || '').trim();
      }
      return;
    }

    if (field === 'description') {
      if (hasMeaningfulValue(aiValue)) {
        const normalizedAiDescription = stripNoiseFromDescription(aiValue);
        if (shouldUseAIDescription(normalizedAiDescription, mergedJob.description)) {
          mergedJob.description = normalizedAiDescription;
        } else {
          mergedJob.description = generateDescription(mergedJob);
        }
      } else {
        mergedJob.description = generateDescription(mergedJob);
      }
      return;
    }

    if (field === 'summary') {
      if (hasMeaningfulValue(aiValue)) {
        mergedJob.summary = aiValue;
      } else {
        mergedJob.summary = generateSummary(mergedJob, mergedJob.description);
      }
      return;
    }

    if (field === 'experience' && !hasMeaningfulValue(existingValue)) {
      const normalizedExperience = hasMeaningfulValue(aiValue) ? String(aiValue).trim() : '';
      const experienceValue = normalizedExperience || 'Any Experience';
      mergedJob.experience = experienceValue;
      return;
    }

    if (field === 'salary' && !hasMeaningfulValue(existingValue)) {
      const normalizedSalary = hasMeaningfulValue(aiValue) ? String(aiValue).trim() : '';
      mergedJob.salary = normalizedSalary || 'Competitive Salary';
      return;
    }

    if (field === 'employment_type' && !hasMeaningfulValue(existingValue)) {
      mergedJob.employment_type = hasMeaningfulValue(aiValue)
        ? aiValue
        : 'Full Time';
      return;
    }

    if (field === 'work_mode' && !hasMeaningfulValue(existingValue)) {
      mergedJob.work_mode = hasMeaningfulValue(aiValue)
        ? aiValue
        : inferWorkModeFromDescription(mergedJob.description || aiValue, 'On-site');
      return;
    }

    if (hasMeaningfulValue(aiValue)) {
      mergedJob[field] = aiValue;
    }
  });

  if (!hasMeaningfulValue(mergedJob.company)) {
    mergedJob.company = normalizeCompanyName(job?.company || job?.company_name || job?.source) || null;
  }

  if (!hasMeaningfulValue(mergedJob.title)) {
    mergedJob.title = String(job?.title || '').trim() || 'Untitled Role';
  }

  if (!hasMeaningfulValue(mergedJob.location)) {
    mergedJob.location = 'Location Not Specified';
  }

  if (!hasMeaningfulValue(mergedJob.description) || !shouldUseAIDescription(mergedJob.description, job.description)) {
    mergedJob.description = generateDescription(mergedJob);
  } else {
    const cleanedDescription = stripNoiseFromDescription(mergedJob.description);
    const paragraphBreaks = cleanedDescription.split(/\n\n+/).filter(Boolean);
    const uniqueParagraphs = paragraphBreaks.filter((paragraph, index) => paragraphBreaks.findIndex((candidate) => candidate.toLowerCase() === paragraph.toLowerCase()) === index);
    if (uniqueParagraphs.length >= 2) {
      mergedJob.description = uniqueParagraphs.join('\n\n');
    } else {
      mergedJob.description = cleanedDescription;
    }
  }

  if (!hasMeaningfulValue(mergedJob.summary)) {
    mergedJob.summary = generateSummary(mergedJob, mergedJob.description);
  }

  if (!hasMeaningfulValue(mergedJob.skills)) {
    mergedJob.skills = inferSkillsFromTitle(mergedJob.title).slice(0, 8);
  }

  if (!hasMeaningfulValue(mergedJob.experience)) {
    mergedJob.experience = 'Any Experience';
  }

  if (!hasMeaningfulValue(mergedJob.salary)) {
    mergedJob.salary = 'Competitive Salary';
  }

  if (!hasMeaningfulValue(mergedJob.employment_type)) {
    mergedJob.employment_type = 'Full Time';
  }

  if (!hasMeaningfulValue(mergedJob.work_mode)) {
    mergedJob.work_mode = inferWorkModeFromDescription(mergedJob.description, 'On-site');
  }

  if (!hasMeaningfulValue(mergedJob.responsibilities)) {
    mergedJob.responsibilities = generateResponsibilities(mergedJob);
  }

  if (!hasMeaningfulValue(mergedJob.benefits)) {
    mergedJob.benefits = generateBenefits();
  }

  return mergedJob;
}

function getMissingFields(job) {
  const missingFields = [];

  if (!hasMeaningfulValue(job?.title)) {
    missingFields.push('title');
  }
  if (!hasMeaningfulValue(job?.company)) {
    missingFields.push('company');
  }
  if (!hasMeaningfulValue(job?.location)) {
    missingFields.push('location');
  }
  if (!hasMeaningfulValue(job?.description) || isPoorDescription(job?.description)) {
    missingFields.push('description');
  }
  if (!hasMeaningfulValue(job?.experience)) {
    missingFields.push('experience');
  }
  if (!hasMeaningfulValue(job?.employment_type)) {
    missingFields.push('employment_type');
  }
  if (!hasMeaningfulValue(job?.work_mode)) {
    missingFields.push('work_mode');
  }
  if (!hasMeaningfulValue(job?.salary)) {
    missingFields.push('salary');
  }
  if (!hasMeaningfulValue(job?.summary)) {
    missingFields.push('summary');
  }
  if (!hasMeaningfulValue(job?.skills)) {
    missingFields.push('skills');
  }
  if (!hasMeaningfulValue(job?.responsibilities)) {
    missingFields.push('responsibilities');
  }
  if (!hasMeaningfulValue(job?.benefits)) {
    missingFields.push('benefits');
  }

  return missingFields;
}

function mergeEnrichment(job, aiResponse) {
  return fillMissingFields(job, aiResponse);
}

function normalizeAIResponse(responseText, dependencies = {}) {
  const loggerInstance = dependencies.logger || logger;
  if (typeof responseText === 'string') {
    return parseEnrichmentResponse(responseText, { logger: loggerInstance });
  }

  if (responseText && typeof responseText === 'object' && !Array.isArray(responseText)) {
    return responseText;
  }

  return parseEnrichmentResponse(String(responseText || ''), { logger: loggerInstance });
}

async function fetchAIResponseWithRetry(prompt, client, providerName, dependencies = {}) {
  const loggerInstance = dependencies.logger || logger;
  let lastError;
  const attempts = 2;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const responseText = await client(prompt, dependencies);
      return normalizeAIResponse(responseText, dependencies);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        loggerInstance.warn(`AI ${providerName} failed after ${attempt} attempts: ${error.message}`);
        throw error;
      }
      loggerInstance.warn(`AI ${providerName} response parse failed on attempt ${attempt}: ${error.message}. Retrying once.`);
    }
  }

  throw lastError;
}

async function enrichJobWithOllama(job, dependencies = {}) {
  const loggerInstance = dependencies.logger || logger;
  const ollamaClient = dependencies.ollamaClient || callOllama;

  const missingFields = getMissingFields(job);
  if (!missingFields.length) {
    loggerInstance.info('AI skipped: all enrichment fields already populated');
    return job;
  }

  const startTime = Date.now();
  loggerInstance.info(`AI started for ${missingFields.join(', ')}`);

  try {
    const prompt = buildEnrichmentPrompt(job, missingFields);
    const parsedResponse = await fetchAIResponseWithRetry(prompt, ollamaClient, 'Ollama', dependencies);
    const mergedJob = mergeEnrichment(job, parsedResponse);
    const elapsedMs = Date.now() - startTime;
    loggerInstance.info(`AI completed in ${elapsedMs}ms`);
    return mergedJob;
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    loggerInstance.warn(`AI failed after ${elapsedMs}ms: ${error.message}`);
    throw error;
  }
}

async function enrichJobWithGroq(job, dependencies = {}) {
  const loggerInstance = dependencies.logger || logger;
  const groqClient = dependencies.groqClient || callGroq;

  const missingFields = getMissingFields(job);
  if (!missingFields.length) {
    loggerInstance.info('AI skipped: all enrichment fields already populated');
    return job;
  }

  const startTime = Date.now();
  loggerInstance.info(`AI started for ${missingFields.join(', ')}`);

  try {
    const prompt = buildEnrichmentPrompt(job, missingFields);
    const parsedResponse = await fetchAIResponseWithRetry(prompt, groqClient, 'Groq', dependencies);
    const mergedJob = mergeEnrichment(job, parsedResponse);
    const elapsedMs = Date.now() - startTime;
    loggerInstance.info(`AI completed in ${elapsedMs}ms`);
    return mergedJob;
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    loggerInstance.warn(`AI failed after ${elapsedMs}ms: ${error.message}`);
    return mergeEnrichment(job, {});
  }
}

module.exports = {
  enrichJobWithOllama,
  enrichJobWithGroq,
  hasMeaningfulValue,
  getMissingFields,
  mergeEnrichment,
  generateDescription,
  generateSummary,
  generateResponsibilities,
  generateBenefits,
  inferSkillsFromTitle,
  fillMissingFields,
};
