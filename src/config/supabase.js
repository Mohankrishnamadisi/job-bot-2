const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { supabaseUrl, supabaseKey } = require('./env');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
  realtime: {
    transport: ws,
  },
});

module.exports = supabase;
