const { fetchSearchPageWithRetries } = require('../src/scrapers/capgemini');

(async () => {
  for (let page = 1; page <= 3; page += 1) {
    const { data, error } = await fetchSearchPageWithRetries(page);
    if (error) {
      console.error('page', page, 'error', error.message);
      continue;
    }
    console.log('page', page, 'count', data.length);
    console.log(data.map((job) => ({ href: job.href, title: job.title })).slice(0, 15));
  }
})();
