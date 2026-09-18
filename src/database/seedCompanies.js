'use strict';

const { ensureCompany, SUPPORTED_COMPANY_NAMES } = require('./companyRepository');

async function seedCompanies() {
  for (const name of SUPPORTED_COMPANY_NAMES) {
    await ensureCompany({ name });
  }
}

seedCompanies()
  .then(() => {
    console.log('Company seed completed');
  })
  .catch((error) => {
    console.error('Company seed failed:', error.message);
  });
