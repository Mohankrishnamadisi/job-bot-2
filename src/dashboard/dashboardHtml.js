function buildDashboardHtml(summary) {
  const overview = summary?.overview || {};
  const queue = summary?.queue || {};
  const health = summary?.health || {};
  const recentFailures = Array.isArray(summary?.recentFailures) ? summary.recentFailures : [];

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Job Bot Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f4f7fb; color: #162033; }
      .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
      .card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 8px 30px rgba(0,0,0,.06); margin-bottom: 16px; }
      h1, h2, h3 { margin-top: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
      .metric { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white; border-radius: 12px; padding: 16px; }
      .metric small { display: block; margin-top: 6px; opacity: 0.9; }
      .status { display: inline-block; padding: 6px 10px; border-radius: 999px; font-weight: bold; }
      .status.healthy { background: #dcfce7; color: #166534; }
      .status.warning { background: #fef3c7; color: #92400e; }
      .table { width: 100%; border-collapse: collapse; }
      .table th, .table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }
      .muted { color: #64748b; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>Job Bot Dashboard</h1>
        <p class="muted">Live view for raw jobs, AI queue, processed jobs, published jobs, and recent pipeline issues.</p>
        <div class="status ${health.status || 'healthy'}">${health.message || 'No status available'}</div>
      </div>

      <div class="grid">
        <div class="metric">
          <h3>${overview.rawJobs ?? 0}</h3>
          <div>Raw jobs</div>
          <small>Jobs captured from scrapers/importers</small>
        </div>
        <div class="metric">
          <h3>${overview.processedJobs ?? 0}</h3>
          <div>Processed jobs</div>
          <small>AI enriched and normalized jobs</small>
        </div>
        <div class="metric">
          <h3>${overview.jobs ?? 0}</h3>
          <div>Published jobs</div>
          <small>Jobs available in the main jobs table</small>
        </div>
        <div class="metric">
          <h3>${overview.companies ?? 0}</h3>
          <div>Companies</div>
          <small>Unique companies discovered</small>
        </div>
      </div>

      <div class="card">
        <h2>Queue status</h2>
        <div class="grid">
          <div class="metric" style="background: linear-gradient(135deg, #0f766e, #14b8a6);">
            <h3>${queue.pending ?? 0}</h3>
            <div>Pending</div>
          </div>
          <div class="metric" style="background: linear-gradient(135deg, #b45309, #f59e0b);">
            <h3>${queue.processing ?? 0}</h3>
            <div>Processing</div>
          </div>
          <div class="metric" style="background: linear-gradient(135deg, #b91c1c, #ef4444);">
            <h3>${queue.failed ?? 0}</h3>
            <div>Failed</div>
          </div>
          <div class="metric" style="background: linear-gradient(135deg, #15803d, #22c55e);">
            <h3>${queue.completed ?? 0}</h3>
            <div>Completed</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Recent failures</h2>
        ${recentFailures.length > 0 ? `<table class="table"><thead><tr><th>ID</th><th>Raw job</th><th>Issue</th><th>Updated</th></tr></thead><tbody>${recentFailures.map((failure) => `<tr><td>${failure.id || 'n/a'}</td><td>${failure.rawJobId || 'n/a'}</td><td>${failure.message || 'Unknown issue'}</td><td>${failure.updatedAt ? new Date(failure.updatedAt).toLocaleString() : 'n/a'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recent failures detected.</p>'}
      </div>
    </div>
  </body>
</html>`;
}

module.exports = {
  buildDashboardHtml,
};
