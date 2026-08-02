import { createClient } from '@supabase/supabase-js';

// Always target the public schema — explicit prevents any default-schema drift.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'public' } }
);
