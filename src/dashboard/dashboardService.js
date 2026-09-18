function buildDashboardSummary(data = {}) {
  const rawJobsCount = Number(data.rawJobsCount || 0);
  const processedJobsCount = Number(data.processedJobsCount || 0);
  const jobsCount = Number(data.jobsCount || 0);
  const companyCount = Number(data.companyCount || 0);
  const aiQueueStatusCounts = data.aiQueueStatusCounts || {};
  const recentFailures = Array.isArray(data.recentFailures) ? data.recentFailures : [];

  const queue = {
    pending: Number(aiQueueStatusCounts.Pending || 0),
    processing: Number(aiQueueStatusCounts.Processing || 0),
    failed: Number(aiQueueStatusCounts.Failed || 0),
    completed: Number(aiQueueStatusCounts.Completed || 0),
  };

  const pendingRatio = rawJobsCount > 0 ? (queue.pending / rawJobsCount) * 100 : 0;
  const health = queue.failed > 0 || queue.processing > 0
    ? { status: 'warning', message: 'Pipeline is active but some items need attention.' }
    : { status: 'healthy', message: 'Everything looks healthy.' };

  return {
    overview: {
      rawJobs: rawJobsCount,
      processedJobs: processedJobsCount,
      jobs: jobsCount,
      companies: companyCount,
    },
    queue,
    companyCount,
    health,
    pendingRatio: Number(pendingRatio.toFixed(1)),
    recentFailures: recentFailures.map((failure) => ({
      id: failure.id || failure.raw_job_id || 'unknown',
      rawJobId: failure.raw_job_id || null,
      message: failure.last_error || failure.message || 'Unknown failure',
      updatedAt: failure.updated_at || failure.updatedAt || null,
    })),
  };
}

async function getDashboardSummary(options = {}) {
  const supabase = options.supabase;
  if (!supabase) {
    return buildDashboardSummary({});
  }

  const results = await Promise.allSettled([
    supabase.from('raw_jobs').select('id', { count: 'exact', head: true }),
    supabase.from('processed_jobs').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true }),
    supabase.from('companies').select('id', { count: 'exact', head: true }),
    supabase.from('ai_queue').select('status'),
  ]);

  const counts = {
    rawJobsCount: 0,
    processedJobsCount: 0,
    jobsCount: 0,
    companyCount: 0,
    aiQueueStatusCounts: {},
  };

  const [rawJobsResult, processedJobsResult, jobsResult, companiesResult, aiQueueResult] = results;
  if (rawJobsResult.status === 'fulfilled' && rawJobsResult.value?.count != null) {
    counts.rawJobsCount = rawJobsResult.value.count;
  }
  if (processedJobsResult.status === 'fulfilled' && processedJobsResult.value?.count != null) {
    counts.processedJobsCount = processedJobsResult.value.count;
  }
  if (jobsResult.status === 'fulfilled' && jobsResult.value?.count != null) {
    counts.jobsCount = jobsResult.value.count;
  }
  if (companiesResult.status === 'fulfilled' && companiesResult.value?.count != null) {
    counts.companyCount = companiesResult.value.count;
  }

  if (aiQueueResult.status === 'fulfilled' && !aiQueueResult.value?.error && Array.isArray(aiQueueResult.value?.data)) {
    aiQueueResult.value.data.forEach((item) => {
      const status = item.status || 'Unknown';
      counts.aiQueueStatusCounts[status] = (counts.aiQueueStatusCounts[status] || 0) + 1;
    });
  }

  let recentFailures = [];
  try {
    const recentFailuresResult = await supabase
      .from('ai_queue')
      .select('id, raw_job_id, last_error, updated_at')
      .in('status', ['Failed', 'Processing'])
      .order('updated_at', { ascending: false })
      .limit(10);

    if (!recentFailuresResult.error && Array.isArray(recentFailuresResult.data)) {
      recentFailures = recentFailuresResult.data;
    }
  } catch (error) {
    recentFailures = [];
  }

  return buildDashboardSummary({
    ...counts,
    recentFailures,
  });
}

module.exports = {
  buildDashboardSummary,
  getDashboardSummary,
};
