'use strict';

const { createClient } = require('@supabase/supabase-js');

function createDb1Client(options = {}) {
  const url = (options.url ?? process.env.DB1_SUPABASE_URL)?.trim();
  const serviceRoleKey = (options.serviceRoleKey ?? process.env.DB1_SUPABASE_SERVICE_ROLE_KEY)?.trim();

  if (!url || !serviceRoleKey) {
    return {
      from(table) {
        throw new Error(
          `DB1 Supabase is not configured. Set DB1_SUPABASE_URL and DB1_SUPABASE_SERVICE_ROLE_KEY to access ${table}.`
        );
      },
    };
  }

  return (options.createClient || createClient)(url, serviceRoleKey);
}

module.exports = createDb1Client();
module.exports.createDb1Client = createDb1Client;
