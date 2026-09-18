'use strict';

function normalizeSalary(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return { salary: null, currency: null };
  }

  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const nonInformative = ['competitive salary', 'negotiable', 'depends on experience', 'market rate', 'not disclosed', 'not specified', 'to be discussed', 'tbd'];
  if (nonInformative.includes(normalized)) {
    return { salary: null, currency: null };
  }

  const currencyMatch = text.match(/(₹|usd|\$|€|£)/i);
  const currency = currencyMatch ? (currencyMatch[1].toLowerCase() === '₹' ? 'INR' : currencyMatch[1].toLowerCase() === '$' || currencyMatch[1].toLowerCase() === 'usd' ? 'USD' : currencyMatch[1].toLowerCase() === '€' ? 'EUR' : currencyMatch[1].toLowerCase() === '£' ? 'GBP' : null) : null;

  const cleaned = text.replace(/,/g, '').replace(/₹/g, '').replace(/\$/g, '').replace(/€/g, '').replace(/£/g, '');
  const amountMatches = cleaned.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?))?/i);
  if (!amountMatches) {
    return { salary: null, currency };
  }

  const first = Number(amountMatches[1]);
  const second = amountMatches[2] != null ? Number(amountMatches[2]) : null;
  const hasLpaHint = /lpa|lakhs?|lac/i.test(normalized);
  const factor = hasLpaHint ? 100000 : 1;

  const min = first * factor;
  const max = second != null ? second * factor : first * factor;

  return {
    salary: `${Math.round(min)}-${Math.round(max)}`,
    currency: currency || 'INR',
  };
}

module.exports = {
  normalizeSalary,
};
