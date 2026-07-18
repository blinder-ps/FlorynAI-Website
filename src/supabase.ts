import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerConfig } from './config.js';

let adminClient: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const config = getServerConfig();
  adminClient = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'floryn-server' } }
  });
  return adminClient;
}

export function getSupabaseForToken(accessToken: string): SupabaseClient {
  const config = getServerConfig();
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}
