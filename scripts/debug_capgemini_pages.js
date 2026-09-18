const { scrapeCapgeminiJobs } = require('../src/scrapers/capgemini');

(async () => {
  const result = await scrapeCapgeminiJobs('', '', true, { dryRun: true });
  console.log('result count', result.result.length);
  result.result.slice(0, 25).forEach((job, index) => {
    console.log(index + 1, job.title, job.location, job.department, job.employment_type, job.apply_url);
  });
})();
