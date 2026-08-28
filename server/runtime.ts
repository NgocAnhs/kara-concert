import { readServerConfig, type ServerConfig } from './config.js';
import { createServerDb } from './db.js';
import { createAccessHandler, type AccessAttempt } from './access/handler.js';
import { createTrustedIp } from './access/client-ip.js';
import { createGeminiProvider } from './imports/gemini.js';
import { createImportHandler, createImportStatusHandler, type ImportHandlerDependencies } from './imports/handler.js';
import { createImportRepository } from './imports/repository.js';
import { createYouTubeProvider } from './imports/youtube.js';
import { createMaintenanceHandler, createMaintenanceRepository, runMaintenance } from './maintenance.js';

export function createRuntimeAccessHandler(env: Record<string, string | undefined> = process.env) {
  let config: ServerConfig | undefined;
  try { config = readServerConfig(env); } catch { /* The handler returns a safe 503. */ }
  const current = config;
  return createAccessHandler({
    config: current,
    now: () => Math.floor(Date.now() / 1000),
    trustedIp: current ? createTrustedIp(current, env) : () => null,
    consumeAttempt: async (ipHash): Promise<AccessAttempt> => {
      // Construct only after origin, JSON/schema and trusted-IP guards. Neither
      // session status nor logout needs database or AI provider credentials.
      if (!current) throw new Error('CONFIG_UNAVAILABLE');
      const db = createServerDb(current);
      const { data, error } = await db.rpc('consume_access_attempt', { p_ip_hash: ipHash });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error('CONFIG_UNAVAILABLE');
      const row = data[0];
      if (!row || typeof row.allowed !== 'boolean' || !Number.isSafeInteger(row.retry_after_seconds)
        || row.retry_after_seconds < 0 || (!row.allowed && row.retry_after_seconds < 1)) throw new Error('CONFIG_UNAVAILABLE');
      return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
    },
  });
}

function runtimeImportDependencies(
  env: Record<string, string | undefined>,
  statusOnly: boolean,
): ImportHandlerDependencies {
  let config: ServerConfig | undefined;
  try { config = readServerConfig(env); } catch { /* Handler returns a safe 503. */ }

  let initializedRepository: ImportHandlerDependencies['repository'] | undefined;
  const repository = (): ImportHandlerDependencies['repository'] => {
    if (initializedRepository) return initializedRepository;
    if (!config?.supabaseUrl || !config.supabaseServerKey || (!statusOnly && !config.importEnabled)) {
      throw new Error('CONFIG_UNAVAILABLE');
    }
    initializedRepository = createImportRepository(createServerDb(config), { aiModel: config.geminiModel });
    return initializedRepository;
  };

  let initializedRunner: Omit<ImportHandlerDependencies['runnerDeps'], 'now'> | undefined;
  const runner = (): Omit<ImportHandlerDependencies['runnerDeps'], 'now'> => {
    if (initializedRunner) return initializedRunner;
    if (statusOnly || !config?.importEnabled || !config.youtubeDataApiKey || !config.geminiApiKey) {
      throw new Error('CONFIG_UNAVAILABLE');
    }
    const youtube = createYouTubeProvider({ apiKey: config.youtubeDataApiKey });
    const gemini = createGeminiProvider({
      apiKey: config.geminiApiKey, model: config.geminiModel,
      deadlineAt: Number.POSITIVE_INFINITY,
      onDiagnostic: (diagnostic) => console.error('GEMINI_PROVIDER_DIAGNOSTIC', JSON.stringify(diagnostic)),
    });
    initializedRunner = { fetchVideo: youtube.fetchVideo, transcribe: gemini.transcribe, enrich: gemini.enrich };
    return initializedRunner;
  };

  const lazyRepository: ImportHandlerDependencies['repository'] = {
    admit: (...args) => repository().admit(...args),
    getJob: (...args) => repository().getJob(...args),
    getVideoState: (...args) => repository().getVideoState(...args),
    advance: (...args) => repository().advance(...args),
    fail: (...args) => repository().fail(...args),
    recordGeminiOutput: (...args) => repository().recordGeminiOutput(...args),
    complete: (...args) => repository().complete(...args),
    completeCached: (...args) => repository().completeCached(...args),
  };
  const runnerDeps: ImportHandlerDependencies['runnerDeps'] = {
    fetchVideo: (...args) => runner().fetchVideo(...args),
    transcribe: (...args) => runner().transcribe(...args),
    enrich: (...args) => runner().enrich(...args),
    now: Date.now,
  };

  return { config, repository: lazyRepository, runnerDeps, nowSeconds: () => Math.floor(Date.now() / 1000) };
}

export function createRuntimeImportHandler(env: Record<string, string | undefined> = process.env) {
  return createImportHandler(runtimeImportDependencies(env, false));
}

export function createRuntimeImportStatusHandler(env: Record<string, string | undefined> = process.env) {
  return createImportStatusHandler(runtimeImportDependencies(env, true));
}

type MaintenanceRuntimeConfig = {
  cronSecret: string;
  supabaseUrl: string;
  supabaseServerKey: string;
  youtubeDataApiKey?: string;
};

function maintenanceConfig(env: Record<string, string | undefined>): MaintenanceRuntimeConfig | undefined {
  if (!env.CRON_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVER_KEY) return undefined;
  return {
    cronSecret: env.CRON_SECRET,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServerKey: env.SUPABASE_SERVER_KEY,
    youtubeDataApiKey: env.YOUTUBE_DATA_API_KEY || undefined,
  };
}

export function createRuntimeMaintenanceHandler(env: Record<string, string | undefined> = process.env) {
  const config = maintenanceConfig(env);
  return createMaintenanceHandler({
    cronSecret: config?.cronSecret,
    run: async () => {
      if (!config) throw new Error('CONFIG_UNAVAILABLE');
      const repository = createMaintenanceRepository(createServerDb(config));
      let fetchVideo: ReturnType<typeof createYouTubeProvider>['fetchVideo'] | undefined;
      await runMaintenance({
        ...repository,
        fetchVideo: (...args) => {
          if (!fetchVideo) {
            if (!config.youtubeDataApiKey) throw new Error('CONFIG_UNAVAILABLE');
            fetchVideo = createYouTubeProvider({ apiKey: config.youtubeDataApiKey }).fetchVideo;
          }
          return fetchVideo(...args);
        },
        now: Date.now,
      });
    },
  });
}
