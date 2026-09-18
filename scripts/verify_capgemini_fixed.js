const fs = require('fs');
const path = require('path');
const { scrapeCapgeminiJobs, normalizeJob } = require('../src/scrapers/capgemini');

function ensureOutputDir() {
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  return outDir;
}

(async () => {
  const result = await scrapeCapgeminiJobs('', '', false, { dryRun: true });
  const jobs = (result.result || []).slice(0, 20);
  const outDir = ensureOutputDir();
  fs.writeFileSync(path.join(outDir, 'capgemini-sample-fixed.json'), JSON.stringify(jobs, null, 2));

  const missingTitle = jobs.filter((job) => !job.title || typeof job.title !== 'string' || job.title.trim() === '');
  const missingUrl = jobs.filter((job) => !job.apply_url || typeof job.apply_url !== 'string' || job.apply_url.trim() === '');
  const duplicateUrls = jobs
    .map((job) => job.apply_url)
    .filter(Boolean)
    .filter((url, index, arr) => arr.indexOf(url) !== index);
  const mergedLocation = jobs.filter((job) => job.title && job.location && job.title.includes(job.location));

  console.log('Total jobs fetched:', result.result.length);
  console.log('Jobs saved:', jobs.length);
  console.log('Missing title count:', missingTitle.length);
  console.log('Missing apply_url count:', missingUrl.length);
  console.log('Duplicate apply_url count:', duplicateUrls.length);
  console.log('Merged title/location count:', mergedLocation.length);

  if (jobs.length >= 20 && missingTitle.length === 0 && missingUrl.length === 0 && duplicateUrls.length === 0 && mergedLocation.length === 0) {
    console.log('CAPGEMINI READY');
    process.exit(0);
  }

  console.log('CAPGEMINI NOT READY');
  if (missingTitle.length) console.log('Missing title records:', missingTitle.map((job, i) => ({ index: i, apply_url: job.apply_url })));
  if (missingUrl.length) console.log('Missing apply_url records:', missingUrl.map((job, i) => ({ index: i, title: job.title })));
  if (duplicateUrls.length) console.log('Duplicate URLs:', duplicateUrls);
  if (mergedLocation.length) console.log('Merged title/location records:', mergedLocation.map((job) => ({ title: job.title, location: job.location, apply_url: job.apply_url })));
  process.exit(2);
})();
