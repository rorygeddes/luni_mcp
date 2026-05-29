// get-token.example.js
// Copy to get-token.js and set env vars (never commit get-token.js).
//
//   export SUPABASE_URL=https://your-project.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
//   export LUNI_EMAIL=you@example.com
//   node get-token.js

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.LUNI_EMAIL;

if (!url || !serviceRoleKey || !email) {
  console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and LUNI_EMAIL');
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email,
});

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

console.log('\nOpen this link in your browser (expires in ~1 hour):\n');
console.log(data.properties?.action_link ?? data.action_link);
