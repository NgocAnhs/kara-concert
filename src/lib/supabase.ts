import { createClient } from '@supabase/supabase-js';
import type { PublicCatalogClient } from '../repositories/songRepository';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: PublicCatalogClient | null =
  supabaseUrl && supabaseAnonKey ? (createClient(supabaseUrl, supabaseAnonKey) as unknown as PublicCatalogClient) : null;
