'use strict';

function mapJob(company, job) {
  return {
    company_id: company.id,
    title: job.title,
    location: job.location,
    experience: job.experience,
    employment_type: job.employment_type,
    work_mode: job.work_mode,
    salary: job.salary,
    description: job.description,
    summary: job.summary,
    skills: job.skills,
    apply_url: job.apply_url,
    source: 'ATS',
    posted_date: job.posted_date,
    expiry_date: job.expiryDate,
    status: 'active',
    is_active: true,
    external_job_id: job.external_job_id,
  };
}

module.exports = {
  mapJob,
};
