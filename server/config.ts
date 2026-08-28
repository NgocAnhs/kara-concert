export type ServerConfig = {
  importAccessToken: string;
  appOrigin: string;
  localDev: boolean;
  importEnabled: boolean;
  geminiModel: string;
  geminiApiKey?: string;
  youtubeDataApiKey?: string;
  supabaseUrl?: string;
  supabaseServerKey?: string;
  cronSecret?: string;
};

type ServerEnvironment = Record<string, string | undefined>;

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:3000';
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function unavailable(): never {
  throw new Error('CONFIG_UNAVAILABLE');
}

function required(env: ServerEnvironment, key: string): string {
  const value = env[key];
  if (!value) unavailable();
  return value;
}

function isProductionEnvironment(env: ServerEnvironment): boolean {
  return (env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview') || env.NODE_ENV === 'production';
}

function readLocalDev(env: ServerEnvironment): boolean {
  if (env.IMPORT_LOCAL_DEV === undefined || env.IMPORT_LOCAL_DEV === 'false') return false;
  if (env.IMPORT_LOCAL_DEV !== 'true' || isProductionEnvironment(env)) unavailable();
  return true;
}

function readTrustedOrigin(value: string, localDev: boolean): string {
  try {
    const url = new URL(value);
    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && localDev && isLoopback))
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      unavailable();
    }
    return url.origin;
  } catch {
    return unavailable();
  }
}

function readImportEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return unavailable();
}

function optional(env: ServerEnvironment, key: string): string | undefined {
  const value = env[key];
  return value ? value : undefined;
}

export function readServerConfig(env: ServerEnvironment): ServerConfig {
  const importAccessToken = required(env, 'IMPORT_ACCESS_TOKEN');
  if (!BASE64URL_TOKEN.test(importAccessToken)) unavailable();

  const importEnabled = readImportEnabled(env.IMPORT_ENABLED);
  const localDev = readLocalDev(env);
  const geminiModel = importEnabled ? required(env, 'GEMINI_MODEL').trim() : (env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
  if (!geminiModel) unavailable();
  const config: ServerConfig = {
    importAccessToken,
    appOrigin: readTrustedOrigin(env.APP_ORIGIN || (localDev ? DEFAULT_LOCAL_ORIGIN : unavailable()), localDev),
    localDev,
    importEnabled,
    geminiModel,
    geminiApiKey: optional(env, 'GEMINI_API_KEY'),
    youtubeDataApiKey: optional(env, 'YOUTUBE_DATA_API_KEY'),
    supabaseUrl: optional(env, 'SUPABASE_URL'),
    supabaseServerKey: optional(env, 'SUPABASE_SERVER_KEY'),
    cronSecret: optional(env, 'CRON_SECRET'),
  };

  if (
    config.importEnabled
    && (!config.geminiApiKey || !config.youtubeDataApiKey || !config.supabaseUrl || !config.supabaseServerKey)
  ) {
    unavailable();
  }

  return config;
}
