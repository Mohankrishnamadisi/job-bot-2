'use strict';

function detectEducation(job) {
  const textSources = [
    job?.title,
    job?.description,
    job?.summary,
    job?.responsibilities,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());

  const combinedText = textSources.join(' ').toLowerCase();

  if (!combinedText) {
    return 'Not Specified';
  }

  if (/(bachelor(?:'s)?\s+degree|bachelor degree|graduate|graduation)/.test(combinedText)) {
    return "Bachelor's Degree";
  }

  if (/(master(?:'s)?\s+degree|masters? degree|master's|masters)/.test(combinedText)) {
    return "Master's Degree";
  }

  if (/(m\.tech|me|master of technology|master of engineering)/.test(combinedText)) {
    return 'M.Tech / ME';
  }

  if (/(b\.tech|be|btech|bachelor of technology|bachelor of engineering)/.test(combinedText)) {
    return 'B.Tech / BE';
  }

  if (/\bmba\b/.test(combinedText)) {
    return 'MBA';
  }

  if (/\bphd\b|doctorate/.test(combinedText)) {
    return 'PhD';
  }

  if (/12th pass|12th|twelfth/.test(combinedText)) {
    return '12th Pass';
  }

  if (/10th pass|10th|tenth/.test(combinedText)) {
    return '10th Pass';
  }

  if (/(no degree required|no formal education|no education required|high school not required|school not required)/.test(combinedText)) {
    return 'No Formal Education';
  }

  return 'Not Specified';
}

module.exports = {
  detectEducation,
};
