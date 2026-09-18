const express = require('express');
const logger = require('./utils/logger');
const { scheduleJobs, runJobPipeline } = require('./scheduler/cron');
const { ensureBacklogQueueEntries } = require('./database/jobRepository');
const { getDashboardSummary } = require('./dashboard/dashboardService');
const { buildDashboardHtml } = require('./dashboard/dashboardHtml');
const supabase = require('./database/supabaseClient');

const app = express();
app.use(express.json());

const { supabaseUrl, supabaseKey, jobScrapeCron } = require('./config/env');

function shouldInitializeBacklog() {
  return process.env.ENABLE_BACKLOG_MIGRATION === 'true';
}

app.get('/', async (req, res) => {
  try {
    const summary = await getDashboardSummary({ supabase });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(buildDashboardHtml(summary));
  } catch (error) {
    logger.error(`Dashboard load failed: ${error.message}`);
    res.status(500).send(`<html><body><h1>Dashboard error</h1><p>${error.message}</p></body></html>`);
  }
});

app.get('/dashboard', async (req, res) => {
  try {
    const summary = await getDashboardSummary({ supabase });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(buildDashboardHtml(summary));
  } catch (error) {
    logger.error(`Dashboard load failed: ${error.message}`);
    res.status(500).send(`<html><body><h1>Dashboard error</h1><p>${error.message}</p></body></html>`);
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const summary = await getDashboardSummary({ supabase });
    res.status(200).json(summary);
  } catch (error) {
    logger.error(`Dashboard API failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remote.co import is temporarily disabled.

async function main() {
  try {
    logger.info('Job bot backend starting');
    // Validate required environment variables early for clear failure modes
    if (!supabaseUrl || !supabaseKey) {
      logger.error('Required environment variables missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY must be set');
      process.exit(1);
    }
    if (shouldInitializeBacklog()) {
      await ensureBacklogQueueEntries({ logger });
    } else {
      logger.info('Historical AI backlog initialization disabled; new raw jobs will still be queued');
    }

    scheduleJobs();

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
      logger.info(`Job bot backend listening on port ${port}`);
    });
  } catch (error) {
    logger.error(`Application failed to start: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = app;
module.exports.handler = app;
module.exports.shouldInitializeBacklog = shouldInitializeBacklog;
