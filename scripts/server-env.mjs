const FILE_ENV_KEYS = new Set([
  'IMPORT_ACCESS_TOKEN',
  'GEMINI_API_KEY',
  'YOUTUBE_DATA_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVER_KEY',
  'APP_ORIGIN',
  'CRON_SECRET',
  'GEMINI_MODEL',
  'IMPORT_ENABLED',
]);

function invalidServerEnv() {
  throw new Error('SERVER_ENV_INVALID');
}

function parseFile(text) {
  const values = new Map();
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) invalidServerEnv();

    const [, key, rawValue] = match;
    if (!FILE_ENV_KEYS.has(key) || values.has(key)) invalidServerEnv();

    const value = rawValue.trim();
    if (
      (value.startsWith('"') && !value.endsWith('"'))
      || (value.startsWith("'") && !value.endsWith("'"))
    ) {
      invalidServerEnv();
    }
    values.set(key, (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value);
  }

  return values;
}

/**
 * Reads server-only local config as data. Values are never executed or logged.
 */
export function loadServerEnv({ processEnv, tokenText, serverText }) {
  const fileValues = new Map();
  for (const [key, value] of parseFile(tokenText)) {
    if (fileValues.has(key)) invalidServerEnv();
    fileValues.set(key, value);
  }
  for (const [key, value] of parseFile(serverText)) {
    if (fileValues.has(key)) invalidServerEnv();
    fileValues.set(key, value);
  }

  const result = {};
  for (const key of FILE_ENV_KEYS) {
    const hasProcessValue = Object.prototype.hasOwnProperty.call(processEnv, key);
    const processValue = processEnv[key];
    const fileValue = fileValues.get(key);
    if (hasProcessValue && fileValue !== undefined && processValue !== fileValue) invalidServerEnv();
    if (hasProcessValue && processValue !== undefined) result[key] = processValue;
    else if (fileValue !== undefined) result[key] = fileValue;
  }

  if (result.APP_ORIGIN === undefined) result.APP_ORIGIN = 'http://127.0.0.1:3000';
  result.IMPORT_LOCAL_DEV = 'true';
  return result;
}
