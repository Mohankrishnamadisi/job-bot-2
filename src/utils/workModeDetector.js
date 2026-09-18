'use strict';

const REMOTE_ONLY_SOURCES = new Set(['remoteok', 'remotive', 'we work remotely', 'weworkremotely']);

function detectWorkMode(job = {}) {
  const source = String(job?.source || '').trim().toLowerCase();
  if (REMOTE_ONLY_SOURCES.has(source)) {
    return 'Remote';
  }

  const textChunks = [
    job?.title,
    job?.location,
    job?.description,
    job?.summary,
    job?.responsibilities,
  ].filter((value) => value != null && String(value).trim() !== '');

  const haystack = textChunks.map((value) => String(value)).join(' ').toLowerCase();
  if (!haystack) {
    return 'Unknown';
  }

  const remoteSignals = ['remote', 'work from home', 'wfh', 'fully remote', 'remote first'];
  const hybridSignals = ['hybrid', 'flexible hybrid', 'hybrid work'];
  const onsiteSignals = ['onsite', 'on site', 'office', 'office based', 'work from office', 'wfo', 'in office'];

  if (remoteSignals.some((signal) => haystack.includes(signal))) {
    return 'Remote';
  }

  if (hybridSignals.some((signal) => haystack.includes(signal))) {
    return 'Hybrid';
  }

  if (onsiteSignals.some((signal) => haystack.includes(signal))) {
    return 'Onsite';
  }

  return 'Unknown';
}

module.exports = {
  detectWorkMode,
  REMOTE_ONLY_SOURCES,
};
