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
        console.log(`${prefix} ${message}`, meta);
    }
}
