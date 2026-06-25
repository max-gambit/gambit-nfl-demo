import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    '[db] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — DB calls will fail.\n' +
      '    Copy .env.example to .env and fill in your Supabase project credentials.',
  );
}

export const db = createClient(url ?? 'http://placeholder', key ?? 'placeholder', {
  auth: { persistSession: false },
});
