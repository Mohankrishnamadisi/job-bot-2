const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Supabase env missing');
  process.exit(1);
}
const supabase = createClient(url, key);
async function count(table, filter) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) {
    query = filter(query);
  }
  const { error, count } = await query;
  if (error) {
    console.error(`Error counting ${table}:`, error.message);
    process.exit(1);
  }
  return count;
}
(async () => {
  console.log('raw_jobs', await count('raw_jobs'));
  console.log('ai_queue Pending', await count('ai_queue', q => q.eq('status', 'Pending')));
  console.log('ai_queue Processing', await count('ai_queue', q => q.eq('status', 'Processing')));
  console.log('ai_queue Failed', await count('ai_queue', q => q.eq('status', 'Failed')));
  console.log('processed_jobs', await count('processed_jobs'));
  console.log('jobs', await count('jobs'));
})();
