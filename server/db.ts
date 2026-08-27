import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from './config.js';

export type ServerDbConfig = Pick<ServerConfig, 'supabaseUrl' | 'supabaseServerKey'>;

function unavailable(): never {
  throw new Error('CONFIG_UNAVAILABLE');
}

export function createServerDb(config: ServerDbConfig): SupabaseClient {
  if (typeof window !== 'undefined') throw new Error('SERVER_ONLY');
  if (!config.supabaseUrl || !config.supabaseServerKey) unavailable();

  try {
    const url = new URL(config.supabaseUrl);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || /[?#]/.test(config.supabaseUrl)) unavailable();
    return createClient(config.supabaseUrl, config.supabaseServerKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    return unavailable();
  }
}
