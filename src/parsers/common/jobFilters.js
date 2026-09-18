'use strict';

function normalizeText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '')).join(' ');
  }
  return String(value);
}

function isIndiaJob(job) {
  if (!job) return false;

  const text = normalizeText([
    job.country,
    job.location,
    job.description,
    job.title,
  ]).toLowerCase();

  return text.includes('india');
}

function isRemoteJob(job) {
  const text = `
    ${job.location || ''}
    ${job.work_mode || ''}
    ${job.description || ''}
  `.toLowerCase();

  return (
    text.includes('remote') ||
    text.includes('work from home') ||
    text.includes('home office')
  );
}

function shouldSaveJob(job) {
  if (isIndiaJob(job)) {
    return true;
  }

  if (isRemoteJob(job)) {
    return true;
  }

  return false;
}

module.exports = {
  isIndiaJob,
  isRemoteJob,
  shouldSaveJob,
};
