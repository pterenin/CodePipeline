import { execa } from "execa";
const VALIDATION_COMMANDS = [
    ["npm", "ci"],
    ["npm", "run", "lint"],
    ["npm", "run", "typecheck"],
    ["npm", "test", "--", "--runInBand"]
];
export class ValidatorService {
    async run(repoPath) {
        const steps = [];
        for (const commandParts of VALIDATION_COMMANDS) {
            const [command, ...args] = commandParts;
            try {
                const result = await execa(command, args, {
                    cwd: repoPath,
                    reject: false,
                    all: false
                });
                const step = {
                    command: commandParts.join(" "),
                    success: result.exitCode === 0,
                    exitCode: result.exitCode ?? null,
                    stdout: result.stdout,
                    stderr: result.stderr
                };
                steps.push(step);
                if (!step.success) {
                    return { success: false, steps };
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                steps.push({
                    command: commandParts.join(" "),
                    success: false,
                    exitCode: 1,
                    stdout: "",
                    stderr: message
                });
                return { success: false, steps };
            }
        }
        return { success: true, steps };
    }
}
