'use strict';

const { VALID_WORK_MODES, VALID_EMPLOYMENT_TYPES } = require('./promptBuilder');

function normalizeText(value) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    return String(value);
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeExperience(value) {
  const text = normalizeText(value);
  if (!text) {
    return 'Any Experience';
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalized.includes('0-1') || normalized.includes('0 to 1') || normalized.includes('less than 1')) {
    return '0-1 Years';
  }
  if (normalized.includes('1-3') || normalized.includes('1 to 3') || normalized.includes('1 year') || normalized.includes('2 years')) {
    return '1-3 Years';
  }
  if (normalized.includes('2-4') || normalized.includes('2 to 4') || normalized.includes('3 years')) {
    return '2-4 Years';
  }
  if (normalized.includes('3-5') || normalized.includes('3 to 5') || normalized.includes('4 years')) {
    return '3-5 Years';
  }
  if (normalized.includes('4-6') || normalized.includes('4 to 6') || normalized.includes('5 years')) {
    return '4-6 Years';
  }
  if (normalized.includes('5-8') || normalized.includes('5 to 8') || normalized.includes('6 years') || normalized.includes('7 years')) {
    return '5-8 Years';
  }
  if (normalized.includes('8-10') || normalized.includes('8 to 10') || normalized.includes('8 years') || normalized.includes('9 years')) {
    return '8-10 Years';
  }
  if (normalized.includes('10+') || normalized.includes('10 years') || normalized.includes('more than 10')) {
    return '10+ Years';
  }
  if (normalized.includes('any') || normalized.includes('no') || normalized.includes('fresh')) {
    return 'Any Experience';
  }

  return text;
}

function normalizeSalary(value) {
  const text = normalizeText(value);
  if (!text) {
    return 'Competitive Salary';
  }

  return text;
}

function normalizeEmploymentType(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (['full time', 'full-time', 'fulltime'].includes(normalized)) {
    return 'Full Time';
  }
  if (['part time', 'part-time', 'parttime'].includes(normalized)) {
    return 'Part Time';
  }
  if (normalized === 'contract') {
    return 'Contract';
  }
  if (normalized === 'freelance') {
    return 'Freelance';
  }
  if (normalized === 'internship') {
    return 'Internship';
  }
  if (normalized === 'unknown') {
    return 'Unknown';
  }
  return text;
}

function normalizeWorkMode(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (['remote', 'work from home'].includes(normalized)) {
    return 'Remote';
  }
  if (['hybrid', 'hybrid remote'].includes(normalized)) {
    return 'Hybrid';
  }
  if (['onsite', 'on-site', 'on site'].includes(normalized)) {
    return 'On-site';
  }
  if (normalized === 'unknown') {
    return 'Unknown';
  }
  return text;
}

function normalizeSummary(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  return text;
}

function normalizeArrayField(value) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .filter((item) => item != null)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const splitItems = value
      .split(/[\n,;]+/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
    return splitItems.length ? splitItems : null;
  }

  return null;
}

function sanitizeRawJsonText(text) {
  let candidate = String(text || '');

  candidate = candidate.replace(/\uFEFF/g, '');
  candidate = candidate.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  candidate = candidate.replace(/[\u2018\u2019]/g, "'");
  candidate = candidate.replace(/[\u201c\u201d]/g, '"');
  candidate = candidate.replace(/\r\n/g, '\n');

  return candidate;
}

function escapeUnescapedNewlinesInStrings(text) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"' && !escaped) {
      inString = !inString;
      result += char;
      continue;
    }

    if (char === '\\' && !escaped) {
      escaped = true;
      result += char;
      continue;
    }

    if (inString && !escaped && (char === '\n' || char === '\r')) {
      result += '\\n';
      continue;
    }

    if (inString && !escaped && char === '\t') {
      result += '\\t';
      continue;
    }

    escaped = false;
    result += char;
  }

  return result;
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*(?=[}\]])/g, '');
}

function collapseDuplicateCommas(text) {
  return text.replace(/,(\s*,)+/g, ',');
}

function escapeInvalidBackslashes(text) {
  return text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

function quoteUnquotedJsonKeys(text) {
  return text.replace(/([\{,]\s*)([A-Za-z0-9_\-]+)\s*:/g, '$1"$2":');
}

function extractJsonCandidate(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    throw new Error('AI response was empty');
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1] : raw;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1).trim();
  }

  return candidate.trim();
}

function attemptJsonParse(candidate, logger) {
  let rawCandidate = sanitizeRawJsonText(candidate);
  let recoveryDetails = [];

  try {
    return { parsed: JSON.parse(rawCandidate), recovered: false, recoveryDetails };
  } catch (firstError) {
    recoveryDetails.push('initial parse failed');
    logger?.warn(`JSON recovery step 1 failed: ${firstError.message}`);
  }

  const repaired = escapeUnescapedNewlinesInStrings(rawCandidate);
  try {
    return { parsed: JSON.parse(repaired), recovered: true, recoveryDetails: [...recoveryDetails, 'escaped unescaped newlines'] };
  } catch (secondError) {
    recoveryDetails.push('escaped unescaped newlines');
    logger?.warn(`JSON recovery step 2 failed: ${secondError.message}`);
  }

  const cleaned = escapeInvalidBackslashes(removeTrailingCommas(collapseDuplicateCommas(repaired)));
  try {
    return { parsed: JSON.parse(cleaned), recovered: true, recoveryDetails: [...recoveryDetails, 'removed trailing commas and escaped backslashes'] };
  } catch (thirdError) {
    recoveryDetails.push('removed trailing commas and escaped backslashes');
    logger?.warn(`JSON recovery step 3 failed: ${thirdError.message}`);
  }

  const quotedKeys = quoteUnquotedJsonKeys(cleaned);
  try {
    return { parsed: JSON.parse(quotedKeys), recovered: true, recoveryDetails: [...recoveryDetails, 'quoted unquoted object keys'] };
  } catch (fourthError) {
    recoveryDetails.push('quoted unquoted object keys');
    logger?.warn(`JSON recovery step 4 failed: ${fourthError.message}`);
  }

  throw new Error(`AI response was not valid JSON after recovery attempts: ${recoveryDetails.join(' -> ')}`);
}

function parseEnrichmentResponse(rawResponse, options = {}) {
  const loggerInstance = options.logger || console;
  const responseText = String(rawResponse || '');
  const rawLength = responseText.length;

  loggerInstance.info(`AI response length: ${rawLength}`);

  const candidate = extractJsonCandidate(responseText);

  let parsed;
  try {
    parsed = JSON.parse(candidate);
    loggerInstance.info('AI response parsed as valid JSON without recovery');
  } catch (initialError) {
    loggerInstance.warn(`AI response invalid JSON: ${initialError.message}`);
    const recovery = attemptJsonParse(candidate, loggerInstance);
    parsed = recovery.parsed;
    loggerInstance.info(`AI JSON recovery succeeded: ${recovery.recovered ? recovery.recoveryDetails.join(' | ') : 'none'}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI response JSON root must be an object');
  }

  const output = {};

  if (Object.prototype.hasOwnProperty.call(parsed, 'title')) {
    const title = normalizeText(parsed.title);
    if (title !== null && typeof title !== 'string') {
      throw new Error('AI response field "title" must be a string or null');
    }
    output.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'location')) {
    const location = normalizeText(parsed.location);
    output.location = location;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'description')) {
    const description = normalizeText(parsed.description);
    output.description = description;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'experience')) {
    const experience = normalizeExperience(parsed.experience);
    output.experience = experience;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'employment_type')) {
    const employmentType = normalizeEmploymentType(parsed.employment_type);
    output.employment_type = employmentType;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'work_mode')) {
    const workMode = normalizeWorkMode(parsed.work_mode);
    output.work_mode = workMode;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'salary')) {
    const salary = normalizeSalary(parsed.salary);
    output.salary = salary;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'summary')) {
    output.summary = normalizeSummary(parsed.summary);
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'skills')) {
    const skills = normalizeArrayField(parsed.skills);
    output.skills = skills;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'responsibilities')) {
    const responsibilities = normalizeArrayField(parsed.responsibilities);
    output.responsibilities = responsibilities;
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'benefits')) {
    const benefits = normalizeArrayField(parsed.benefits);
    output.benefits = benefits;
  }

  return output;
}

module.exports = {
  parseEnrichmentResponse,
};
