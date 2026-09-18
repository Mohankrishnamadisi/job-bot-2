'use strict';

const { detectWorkMode } = require('./workModeDetector');

function normalizeWorkMode(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return 'Unknown';
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  if (['remote', 'work from home', 'wfh'].includes(normalized)) {
    return 'Remote';
  }

  if (['hybrid', 'hybrid work', 'flexible hybrid'].includes(normalized)) {
    return 'Hybrid';
  }

  if (['onsite', 'on-site', 'on site', 'office', 'office based', 'work from office', 'wfo', 'in office'].includes(normalized)) {
    return 'Onsite';
  }

  if (normalized === 'unknown') {
    return 'Unknown';
  }

  return 'Unknown';
}

function normalizeJobWorkMode(job) {
  return detectWorkMode(job);
}

module.exports = {
  normalizeWorkMode,
  normalizeJobWorkMode,
};
