import { execa } from "execa";

import type { ValidationResult, ValidationStepResult } from "../types.js";
import { Logger } from "../utils/logger.js";

const VALIDATION_COMMANDS = [
  ["npm", "ci"],
  ["npm", "run", "lint"],
  ["npm", "run", "build"],
  ["npm", "run", "test"],
] as const;

export class ValidatorService {
  private readonly logger = new Logger("validator");

  async run(
    repoPath: string,
    hooks?: {
      onCommandStart?: (command: string) => void;
    },
  ): Promise<ValidationResult> {
    this.logger.info("Starting validation run", { repoPath });
    const steps: ValidationStepResult[] = [];

    for (const commandParts of VALIDATION_COMMANDS) {
      const [command, ...args] = commandParts;
      const commandLabel = commandParts.join(" ");
      this.logger.info("Running validation command", {
        command: commandLabel,
      });
      hooks?.onCommandStart?.(commandLabel);
      try {
        const result = await execa(command, args, {
          cwd: repoPath,
          reject: false,
          all: false,
        });

        const step: ValidationStepResult = {
          command: commandLabel,
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("Validation command threw an unexpected error", {
          command: commandLabel,
          message,
        });
        steps.push({
          command: commandLabel,
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
