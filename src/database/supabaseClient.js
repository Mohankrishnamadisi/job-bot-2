'use strict';

const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)?.trim();

function createFallbackSupabase() {
  return {
    from(table) {
      throw new Error(`Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to access ${table}.`);
    },
  };
}

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : createFallbackSupabase();

module.exports = supabase;
