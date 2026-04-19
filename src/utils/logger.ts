type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[-_]?key|cookie|session)/i;
const CREDENTIAL_IN_URL_PATTERN = /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const QUERY_SECRET_PATTERN = /([?&](?:access_token|token|api_key|apikey|password|secret)=)[^&]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._-]+\b/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]+)\b/g;

export class Logger {
  constructor(private readonly scope: string) {}

  info(message: string, meta?: unknown): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log("error", message, meta);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${this.scope}]`;
    if (meta === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }

    console.log(`${prefix} ${message}`, sanitizeMeta(meta));
  }
}

function sanitizeMeta(meta: unknown, seen = new WeakSet<object>()): unknown {
  if (meta instanceof Error) {
    return sanitizeError(meta, seen);
  }

  if (typeof meta === "string") {
    return redactString(meta);
  }

  if (!meta || typeof meta !== "object") {
    return meta;
  }

  if (seen.has(meta)) {
    return "[Circular]";
  }

  seen.add(meta);

  if (Array.isArray(meta)) {
    return meta.map((value) => sanitizeMeta(value, seen));
  }

  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeMeta(value, seen)
    ])
  );
}

function sanitizeError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message)
  };

  const maybeAxiosError = error as Error & {
    isAxiosError?: boolean;
    code?: string;
    status?: number;
    response?: {
      status?: number;
      statusText?: string;
      data?: unknown;
    };
    config?: {
      method?: string;
      baseURL?: string;
      url?: string;
      timeout?: number;
    };
  };

  if (maybeAxiosError.isAxiosError) {
    base.code = maybeAxiosError.code;
    base.status = maybeAxiosError.response?.status ?? maybeAxiosError.status;
    base.statusText = maybeAxiosError.response?.statusText;
    base.responseData = sanitizeMeta(maybeAxiosError.response?.data, seen);
    base.request = {
      method: maybeAxiosError.config?.method,
      baseURL: maybeAxiosError.config?.baseURL ? redactString(maybeAxiosError.config.baseURL) : undefined,
      url: maybeAxiosError.config?.url ? redactString(maybeAxiosError.config.url) : undefined,
      timeout: maybeAxiosError.config?.timeout
    };
    return base;
  }

  base.stack = error.stack ? redactString(error.stack) : undefined;
  return base;
}

function redactString(value: string): string {
  return value
    .replace(CREDENTIAL_IN_URL_PATTERN, "$1***:***@")
    .replace(QUERY_SECRET_PATTERN, "$1[REDACTED]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(KNOWN_TOKEN_PATTERN, "[REDACTED]");
}
