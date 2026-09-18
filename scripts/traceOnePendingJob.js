const supabase = require('../src/database/supabaseClient');
const { runAiWorker } = require('../src/workers/aiWorker');

(async () => {
  try {
    const { data: queueRows, error } = await supabase
      .from('ai_queue')
      .select('*')
      .eq('status', 'Pending')
      .limit(1);

    if (error) {
      console.error('LOAD PENDING ai_queue FAILED:', JSON.stringify(error, null, 2));
      process.exit(1);
    }

    if (!Array.isArray(queueRows) || queueRows.length === 0) {
      console.log('LOAD PENDING ai_queue SUCCESS: no pending queue rows found');
      process.exit(0);
    }

    const row = queueRows[0];
    console.log('LOAD PENDING ai_queue SUCCESS:', JSON.stringify(row, null, 2));

    const logger = {
      info: (msg) => console.log('INFO:', typeof msg === 'string' ? msg : JSON.stringify(msg)),
      warn: (msg) => console.warn('WARN:', typeof msg === 'string' ? msg : JSON.stringify(msg)),
      error: (msg) => console.error('ERROR:', typeof msg === 'string' ? msg : JSON.stringify(msg)),
      debug: (msg) => console.log('DEBUG:', typeof msg === 'string' ? msg : JSON.stringify(msg)),
    };

    const result = await runAiWorker({ rawJobId: row.raw_job_id, debug: true, logger });
    console.log('runAiWorker debug result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('EXCEPTION:', e);
    process.exit(1);
  }
})();
