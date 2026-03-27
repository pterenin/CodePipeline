type LogLevel = "info" | "warn" | "error";

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

function sanitizeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    return sanitizeError(meta);
  }

  if (!meta || typeof meta !== "object") {
    return meta;
  }

  return meta;
}

function sanitizeError(error: Error): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: error.name,
    message: error.message
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
    base.responseData = maybeAxiosError.response?.data;
    base.request = {
      method: maybeAxiosError.config?.method,
      baseURL: maybeAxiosError.config?.baseURL,
      url: maybeAxiosError.config?.url,
      timeout: maybeAxiosError.config?.timeout
    };
    return base;
  }

  base.stack = error.stack;
  return base;
}
