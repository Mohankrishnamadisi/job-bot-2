const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseKey } = require('./env');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});

module.exports = supabase;
