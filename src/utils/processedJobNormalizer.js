'use strict';

function normalizeExperience(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return 'Any Experience';
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  if (['fresher', 'freshers'].includes(normalized)) {
    return 'Fresher';
  }

  if (['any experience', 'any', 'unknown', 'unclear', 'not specified', 'n/a', 'na'].includes(normalized)) {
    return 'Any Experience';
  }

  const numberMatch = normalized.match(/(\d+)(?:\s*(?:-|to|\+)\s*(\d+))?/);
  if (!numberMatch) {
    return 'Any Experience';
  }

  const firstNumber = Number(numberMatch[1]);
  const secondNumber = numberMatch[2] != null ? Number(numberMatch[2]) : null;

  if (firstNumber <= 0) {
    return '0-1 Years';
  }
  if (firstNumber === 1) {
    return '1-3 Years';
  }
  if (firstNumber === 2) {
    return '2-4 Years';
  }
  if (firstNumber === 3) {
    return '3+ Years';
  }
  if (firstNumber === 4) {
    return '4-6 Years';
  }
  if (firstNumber >= 5 && firstNumber <= 7) {
    return '5-8 Years';
  }
  if (firstNumber >= 8 && firstNumber <= 9) {
    return '8-10 Years';
  }
  if (firstNumber >= 10 || (secondNumber != null && secondNumber >= 10)) {
    return '10+ Years';
  }

  if (secondNumber != null && secondNumber > firstNumber) {
    if (firstNumber === 4 && secondNumber >= 6) {
      return '4-6 Years';
    }
    if (firstNumber >= 5 && secondNumber <= 8) {
      return '5-8 Years';
    }
    if (firstNumber >= 8 && secondNumber <= 10) {
      return '8-10 Years';
    }
  }

  return 'Any Experience';
}

function normalizeEmploymentType(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return 'Full-Time';
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (['full time', 'full-time', 'fulltime'].includes(normalized)) {
    return 'Full-Time';
  }
  if (['part time', 'part-time', 'parttime'].includes(normalized)) {
    return 'Part-Time';
  }
  if (['intern', 'internship', 'internship program'].includes(normalized)) {
    return 'Internship';
  }
  if (['contract', 'temporary'].includes(normalized)) {
    return 'Contract';
  }
  if (['freelance', 'freelancer'].includes(normalized)) {
    return 'Freelance';
  }

  return 'Full-Time';
}

function normalizeLocationForWorkMode(location, workMode) {
  const locationText = String(location ?? '').trim();
  const workModeText = String(workMode ?? '').trim();

  if (!locationText) {
    return { location, workMode: workModeText || 'Onsite' };
  }

  const normalizedLocation = locationText.toLowerCase().replace(/\s+/g, ' ').trim();
  if (
    normalizedLocation.includes('remote') ||
    normalizedLocation.includes('work from home') ||
    normalizedLocation.includes('wfh')
  ) {
    return { location, workMode: 'Remote' };
  }

  if (normalizedLocation.includes('hybrid')) {
    return { location, workMode: 'Hybrid' };
  }

  if (normalizedLocation.includes('onsite') || normalizedLocation.includes('on-site') || normalizedLocation.includes('on site')) {
    return { location, workMode: 'Onsite' };
  }

  return { location, workMode: workModeText || 'Onsite' };
}

module.exports = {
  normalizeExperience,
  normalizeEmploymentType,
  normalizeLocationForWorkMode,
};
