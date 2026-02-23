export interface AppConfig {
  port: number;
  host: string;
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  defaultStream: boolean;
  experimentalToolUsage: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
  bodyLimitBytes: number;
  prefillTokenLimit: number;
  upstreamRequestByteLimit: number;
  wrapperApiKey?: string;
}

/**
 * Parses one integer environment value and falls back safely when empty/invalid.
 * This keeps startup robust even if a user typo exists in `.env`.
 */
function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parses an integer config value and enforces a min/max range.
 * We fail fast on bad limits so the server does not run with unsafe settings.
 */
function parseBoundedNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const parsed = parseNumber(raw, fallback);
  if (parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `${name} must be between ${bounds.min} and ${bounds.max}. Received: ${parsed}`,
    );
  }
  return parsed;
}

/**
 * Parses common boolean text values from environment variables.
 * Accepts user-friendly forms like `yes/no`, `on/off`, and `1/0`.
 */
function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return fallback;
}

/**
 * Builds the full runtime config for the wrapper from environment variables.
 * Think of this as the single source of truth for all server knobs.
 */
export function getConfig(): AppConfig {
  const bodyLimitMb = parseBoundedNumber(
    "BODY_LIMIT_MB",
    process.env.BODY_LIMIT_MB,
    25,
    { min: 1, max: 512 },
  );
  return {
    port: parseBoundedNumber("PORT", process.env.PORT, 8787, {
      min: 1,
      max: 65535,
    }),
    host: process.env.HOST ?? "0.0.0.0",
    upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? "https://chatjimmy.ai",
    upstreamApiKey: process.env.UPSTREAM_API_KEY,
    defaultStream: parseBoolean(process.env.DEFAULT_STREAM, false),
    experimentalToolUsage: parseBoolean(
      process.env.EXPERIMENTAL_TOOL_USAGE,
      false,
    ),
    requestTimeoutMs: parseBoundedNumber(
      "UPSTREAM_TIMEOUT_MS",
      process.env.UPSTREAM_TIMEOUT_MS,
      15000,
      { min: 1000, max: 300000 },
    ),
    maxRetries: parseBoundedNumber(
      "UPSTREAM_MAX_RETRIES",
      process.env.UPSTREAM_MAX_RETRIES,
      2,
      { min: 0, max: 10 },
    ),
    bodyLimitBytes: bodyLimitMb * 1024 * 1024,
    prefillTokenLimit: parseBoundedNumber(
      "UPSTREAM_PREFILL_TOKEN_LIMIT",
      process.env.UPSTREAM_PREFILL_TOKEN_LIMIT,
      6064,
      { min: 256, max: 131072 },
    ),
    upstreamRequestByteLimit: parseBoundedNumber(
      "UPSTREAM_REQUEST_BYTE_LIMIT",
      process.env.UPSTREAM_REQUEST_BYTE_LIMIT,
      1200000,
      { min: 16384, max: 104857600 },
    ),
    wrapperApiKey: process.env.WRAPPER_API_KEY,
  };
}
