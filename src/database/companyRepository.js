'use strict';

const supabase = require('./supabaseClient');
const logger = require('../utils/logger');

const SUPPORTED_COMPANY_NAMES = ['Amazon', 'Microsoft', 'IBM', 'Wipro', 'Cognizant', 'Capgemini', 'Infosys', 'Deloitte', 'Cisco', 'NTT DATA', 'LTIMindtree', 'Mphasis', 'HCLTech', 'TCS'];

const DEFAULT_CAREER_URLS = {
  amazon: 'https://www.amazon.jobs/en',
  microsoft: 'https://careers.microsoft.com/us/en/search-results',
  ibm: 'https://www.ibm.com/careers/search',
  wipro: 'https://careers.wipro.com/',
  cognizant: 'https://careers.cognizant.com/global/en/search-results',
  capgemini: 'https://www.capgemini.com/in-en/careers/job-search/',
  infosys: 'https://careers.infosys.com/',
  deloitte: 'https://apply.deloitte.com/en_US/careers/SearchJobs',
  cisco: 'https://careers.cisco.com/global/en/search-results',
  nttdata: 'https://careers.nttdata.com/global/en/search-results',
  ltimindtree: 'https://www.ltm.com/careers',
  mphasis: 'https://careers.mphasis.com/home.html',
  hcltech: 'https://careers.hcltech.com/',
  tcs: 'https://ibegin.tcsapps.com/candidate/jobs/search',
};

function getDefaultCareerUrl(name) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) return 'https://example.com/careers';
  return DEFAULT_CAREER_URLS[normalizedName] || `https://www.${normalizedName.replace(/\s+/g, '-')}.com/careers`;
}

async function getCompanyByName(name) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return null;
  }

  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .ilike('name', normalizedName)
    .maybeSingle();

  if (error) {
    logger.warn(`Company lookup failed for "${normalizedName}": ${error.message}`);
    return null;
  }

  return data;
}

async function getEnabledCompanies() {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('enabled', true);

  if (error) {
    return [];
  }

  return data || [];
}

async function ensureCompany(companyData) {
  if (!companyData || !companyData.name) {
    return null;
  }

  const payload = {
    name: companyData.name.trim(),
    enabled: companyData.enabled !== false,
    career_url: companyData.career_url || companyData.careerUrl || companyData.url || getDefaultCareerUrl(companyData.name),
  };

  const existing = await getCompanyByName(payload.name);
  if (existing) {
    logger.info(`ensureCompany reused existing company for "${payload.name}"`);
    return existing;
  }

  const { data, error } = await supabase
    .from('companies')
    .insert([payload])
    .select()
    .maybeSingle();

  if (error) {
    logger.error(`Supabase ensureCompany failed for "${payload.name}": ${error.message}`);
    if (error.details) {
      logger.error(`Supabase ensureCompany details: ${error.details}`);
    }
    if (error.hint) {
      logger.error(`Supabase ensureCompany hint: ${error.hint}`);
    }
    return null;
  }

  logger.info(`ensureCompany created company for "${payload.name}"`);
  return data;
}

module.exports = {
  SUPPORTED_COMPANY_NAMES,
  getCompanyByName,
  getEnabledCompanies,
  ensureCompany,
};
