'use strict';

const VALID_WORK_MODES = ['Remote', 'Hybrid', 'On-site', 'Unknown'];
const VALID_EMPLOYMENT_TYPES = ['Full Time', 'Part Time', 'Contract', 'Freelance', 'Internship', 'Unknown'];

function sanitizeValue(value) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.filter((entry) => entry != null && String(entry).trim() !== '');
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  return String(value);
}

function buildEnrichmentPrompt(job, missingFields = []) {
  const normalizedMissing = Array.isArray(missingFields)
    ? missingFields.filter((field) => typeof field === 'string' && field.trim() !== '')
    : [];

  const promptSections = [
    'You are an expert job enrichment engine for recruiting data.',
    'Your job is to produce high-quality, professional job content that is polished, clean, and ready for candidates.',
    'Treat the raw source as noisy and incomplete. You must understand the full job context and rewrite the description completely instead of copying or summarizing the raw text.',
    'Remove HTML, URLs, legal disclaimers, privacy text, duplicate sentences, broken formatting, and scraped noise before writing the final content.',
    'The description must be 220-300 words, written in plain English, with 4 natural paragraphs, and should read like a recruiter-quality job post that is ATS friendly and candidate friendly.',
    'Never copy raw description text, raw paragraphs, or scraped content. Always create a fresh, original description based on the job information provided.',
    'The summary must be 40-60 words, concise, candidate-friendly, and never copied from the raw description.',
    'If responsibilities are missing, generate 4-6 concise bullet points.',
    'If benefits are missing, generate 4-6 professional benefits.',
    'If skills are missing, infer them from the job title and keep them technical, 6-10 items only.',
    'If experience is missing, infer it from the title when possible; otherwise use "Any Experience".',
    'For title, infer the best industry-standard designation from the full job context, not from the raw title alone. Use the raw title, description, summary, responsibilities, skills, company, location, and category together to understand the actual role. Generate one concise, professional, ATS-friendly, search-friendly title that would work on LinkedIn, Naukri, Indeed, and Glassdoor.',
    'Do not simply clean the raw title. Do not use keyword dictionaries or regex-based title mapping. Do not return a generic or vague title when a clearer professional designation is apparent.',
    'If salary is missing, use "Competitive Salary".',
    'If employment type is missing, use "Full Time".',
    'If work mode cannot be determined, return "Unknown". Never assume On-site.',
    'Return ONLY valid JSON.',
    'Do not include markdown, code blocks, explanations, or any extra text.',
    '',
    'Required output rules:',
    '- title: string (required, never null)',
    '- description: string (required, never null)',
    '- summary: string (required, never null)',
    '- skills: array of strings (required, never null)',
    '- experience: string (required, never null)',
    '- employment_type: string (required, never null)',
    '- salary: string (required, never null)',
    '- work_mode: string (required, never null)',
    '- responsibilities: array of strings (required, never null)',
    '- benefits: array of strings (required, never null)',
    '- Never return null for title, description, summary, skills, experience, employment_type, salary, work_mode.',
    '- Experience must be one of: 0-1 Years, 1-3 Years, 2-4 Years, 3-5 Years, 4-6 Years, 5-8 Years, 8-10 Years, 10+ Years, or Any Experience.',
    '- Salary must be normalized like ₹5 LPA, ₹8-12 LPA, $80k-$100k, or Competitive Salary.',
    '- skills must only contain concrete technical capabilities or tools and should be 6-10 items.',
    '- The description should not mention raw metadata, scraping artifacts, or ATS details.',
    '',
    'Requested missing fields:',
    normalizedMissing.length ? normalizedMissing.join(', ') : 'none',
    '',
    'Job data:',
    JSON.stringify({
      title: sanitizeValue(job?.title),
      raw_description: sanitizeValue(job?.description),
      location: sanitizeValue(job?.location),
      company: sanitizeValue(job?.company),
      salary: sanitizeValue(job?.salary),
      experience: sanitizeValue(job?.experience),
      employment_type: sanitizeValue(job?.employment_type),
      work_mode: sanitizeValue(job?.work_mode),
      summary: sanitizeValue(job?.summary),
      skills: sanitizeValue(job?.skills),
      responsibilities: sanitizeValue(job?.responsibilities),
      benefits: sanitizeValue(job?.benefits),
      education: sanitizeValue(job?.education),
    }, null, 2),
  ];

  return promptSections.join('\n');
}

function buildExtractionPrompt(job, missingFields = []) {
  return buildEnrichmentPrompt(job, missingFields);
}

module.exports = {
  buildEnrichmentPrompt,
  buildExtractionPrompt,
  VALID_WORK_MODES,
  VALID_EMPLOYMENT_TYPES,
};
