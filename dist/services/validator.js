import { execa } from "execa";
import { Logger } from "../utils/logger.js";
const VALIDATION_COMMANDS = [
    ["npm", "ci"],
    ["npm", "run", "lint"],
    ["npm", "run", "test"],
];
export class ValidatorService {
    logger = new Logger("validator");
    async run(repoPath) {
        this.logger.info("Starting validation run", { repoPath });
        const steps = [];
        for (const commandParts of VALIDATION_COMMANDS) {
            const [command, ...args] = commandParts;
            this.logger.info("Running validation command", {
                command: commandParts.join(" "),
            });
            try {
                const result = await execa(command, args, {
                    cwd: repoPath,
                    reject: false,
                    all: false,
                });
                const step = {
                    command: commandParts.join(" "),
                    success: result.exitCode === 0,
                    exitCode: result.exitCode ?? null,
                    stdout: result.stdout,
                    stderr: result.stderr,
                };
                steps.push(step);
                this.logger.info("Validation command completed", {
                    command: step.command,
                    success: step.success,
                    exitCode: step.exitCode,
                });
                if (!step.success) {
                    this.logger.warn("Validation run stopped on failed command", {
                        command: step.command,
                    });
                    return { success: false, steps };
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.error("Validation command threw an unexpected error", {
                    command: commandParts.join(" "),
                    message,
                });
                steps.push({
                    command: commandParts.join(" "),
                    success: false,
                    exitCode: 1,
                    stdout: "",
                    stderr: message,
                });
                return { success: false, steps };
            }
        }
        this.logger.info("Validation run finished successfully");
        return { success: true, steps };
    }
}
