const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const { Client } = require('pg');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('Missing env');
  process.exit(1);
}
const match = url.match(/^https?:\/\/(.*?)\.supabase\.co$/);
if (!match) {
  console.error('Bad url');
  process.exit(1);
}
const project = match[1];
const host = `${project}.db.supabase.co`;
const conn = new Client({ host, user: 'postgres', password: key, database: 'postgres', port: 5432, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    await conn.connect();
    const res = await conn.query("select schemaname, tablename, indexname, indexdef from pg_indexes where tablename in ('ai_queue','processed_jobs','jobs','raw_jobs') order by tablename, indexname;");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error('ERR', JSON.stringify({ message: e.message, code: e.code, stack: e.stack }, null, 2));
    process.exit(1);
  } finally {
    await conn.end();
  }
})();
