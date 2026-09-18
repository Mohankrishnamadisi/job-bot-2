const { scrapeCognizantJobs } = require('../src/scrapers/cognizant');
const { scrapeCapgeminiJobs } = require('../src/scrapers/capgemini');

async function run() {
  const targets = [
    { name: 'Cognizant', fn: () => scrapeCognizantJobs('', '', false, { dryRun: true }) },
    { name: 'Capgemini', fn: () => scrapeCapgeminiJobs('', '', false, { dryRun: true }) },
  ];

  for (const target of targets) {
    try {
      const result = await target.fn();
      const jobs = Array.isArray(result?.result) ? result.result : [];
      console.log(`=== ${target.name} ===`);
      console.log('jobsReturned', jobs.length);
      console.log('first5', JSON.stringify(jobs.slice(0, 5), null, 2));
      console.log('sampleApplyUrls', jobs.slice(0, 5).map((job) => job.apply_url).filter(Boolean));
      console.log('stats', JSON.stringify(result?.stats || {}, null, 2));
    } catch (error) {
      console.log(`=== ${target.name} ERROR ===`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
