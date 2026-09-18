'use strict';

const DEFAULT_RECENT_DAYS = 3;

function getConfiguredLookbackDays(daysOverride) {
  const explicitValue = daysOverride ?? process.env.JOB_LOOKBACK_DAYS ?? process.env.SCRAPER_RETENTION_DAYS;
  const parsed = Number(explicitValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RECENT_DAYS;
}

function parseJobDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string' || !value.trim()) return null;

  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRecentCutoff(days = getConfiguredLookbackDays(), now = new Date()) {
  const effectiveDays = getConfiguredLookbackDays(days);
  return new Date(now.getTime() - effectiveDays * 24 * 60 * 60 * 1000);
}

function isJobWithinRecentCutoff(job, options = {}) {
  const postedDate = parseJobDate(job?.posted_date ?? job?.postedDate);
  if (!postedDate) return options.includeUnknownDate === true;

  const now = options.now || new Date();
  const cutoff = options.cutoff || getRecentCutoff(options.days ?? getConfiguredLookbackDays(), now);
  return postedDate >= cutoff && postedDate <= now;
}

function filterJobsWithinRecentCutoff(jobs, options = {}) {
  return (Array.isArray(jobs) ? jobs : []).filter((job) => isJobWithinRecentCutoff(job, options));
}

module.exports = {
  DEFAULT_RECENT_DAYS,
  getConfiguredLookbackDays,
  parseJobDate,
  getRecentCutoff,
  isJobWithinRecentCutoff,
  filterJobsWithinRecentCutoff,
};