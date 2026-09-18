'use strict';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEmploymentType(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.replace(/_/g, ' ').toLowerCase();
  if (/full[- ]?time/i.test(normalized) || normalized === 'full time') return 'Full-Time';
  if (/part[- ]?time/i.test(normalized) || normalized === 'part time') return 'Part-Time';
  if (/contract/i.test(normalized)) return 'Contract';
  if (/intern/i.test(normalized)) return 'Intern';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractExperience(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(\d+\+?\s*years?)(?:\s*(?:of\s*)?experience)?/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim();
}

function extractSalary(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/(USD\s*\$[\d,]+\s*-\s*\$[\d,]+\s*per year|\$[\d,]+\s*-\s*\$[\d,]+\s*per year|USD\s*\$[\d,]+\s*-\s*\$[\d,]+)/i);
  if (!match) return null;
  return match[1].trim();
}

function extractWorkMode(text) {
  if (!text || typeof text !== 'string') return 'onsite';

  const value = text.toLowerCase();

  if (
    value.includes('100% remote') ||
    value.includes('fully remote') ||
    value.includes('remote only') ||
    value.includes('work from home') ||
    value.includes('remote')
  ) {
    return 'remote';
  }

  if (
    value.includes('hybrid') ||
    value.includes('flexible work') ||
    value.includes('flexible workplace')
  ) {
    return 'hybrid';
  }

  return 'onsite';
}

function extractSkillsFromText(text) {
  if (!text || typeof text !== 'string') return [];

  const skillBlockMatch = text.match(/Top skills\s*([\s\S]{1,200})/i);
  if (!skillBlockMatch) return [];

  const rawLines = skillBlockMatch[1]
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const skills = [];
  for (const line of rawLines) {
    if (/^(Previously worked as|Insights from previous hires|Powered by|This site|Job description|Company and benefits|Job number|Date posted|Work site|Travel|Profession|Discipline|Role type|Employment type)$/i.test(line)) {
      break;
    }
    if (/^Top skills$/i.test(line)) {
      continue;
    }
    skills.push(line);
  }

  return skills;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

module.exports = {
  delay,
  parseEmploymentType,
  extractExperience,
  extractSalary,
  extractWorkMode,
  extractSkillsFromText,
  chunkArray,
};
