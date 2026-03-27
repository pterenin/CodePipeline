export class Logger {
    scope;
    constructor(scope) {
        this.scope = scope;
    }
    info(message, meta) {
        this.log("info", message, meta);
    }
    warn(message, meta) {
        this.log("warn", message, meta);
    }
    error(message, meta) {
        this.log("error", message, meta);
    }
    log(level, message, meta) {
        const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${this.scope}]`;
        if (meta === undefined) {
            console.log(`${prefix} ${message}`);
            return;
        }
        console.log(`${prefix} ${message}`, sanitizeMeta(meta));
    }
}
function sanitizeMeta(meta) {
    if (meta instanceof Error) {
        return sanitizeError(meta);
    }
    if (!meta || typeof meta !== "object") {
        return meta;
    }
    return meta;
}
function sanitizeError(error) {
    const base = {
        name: error.name,
        message: error.message
    };
    const maybeAxiosError = error;
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
