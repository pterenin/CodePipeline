import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import axios from "axios";
import { execa } from "execa";
import { Logger } from "../utils/logger.js";
import { truncate } from "../utils/text.js";
export class AgentService {
    config;
    logger = new Logger("agent");
    constructor(config) {
        this.config = config;
    }
    async implementTicket(ticket, repoPath, hooks) {
        hooks?.onProgress?.("Launching Codex CLI in the prepared worktree.");
        return this.runCodex({
            ticket,
            repoPath,
            mode: "implementation",
            ...(hooks ? { hooks } : {}),
        });
    }
    async repairFromValidation(ticket, repoPath, validation, signal) {
        return this.runCodex({
            ticket,
            repoPath,
            mode: "repair",
            validation,
            ...(signal ? { signal } : {}),
        });
    }
    async runCodex(input) {
        const signal = input.signal ?? input.hooks?.signal;
        const jiraImagePaths = await this.prepareJiraImages(input.ticket, input.repoPath, signal);
        const prompt = buildCodexPrompt({
            ...input,
            jiraImagePaths,
        });
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-run-"));
        const outputPath = path.join(tempDir, "last-message.txt");
        this.logger.info("Running Codex CLI", {
            mode: input.mode,
            repoPath: input.repoPath,
            model: this.config.OPENAI_MODEL,
        });
        input.hooks?.onProgress?.("Codex is inspecting the repository and making changes.");
        try {
            const result = await execa(this.config.CODEX_CLI_PATH, [
                "-a",
                "never",
                "exec",
                "--sandbox",
                "workspace-write",
                "--output-last-message",
                outputPath,
                "--skip-git-repo-check",
                "--model",
                this.config.OPENAI_MODEL,
                prompt,
            ], {
                cwd: input.repoPath,
                reject: false,
                ...(signal ? { cancelSignal: signal } : {}),
                env: {
                    ...process.env,
                    OPENAI_API_KEY: this.config.OPENAI_API_KEY,
                },
            });
            const summary = await readSummary(outputPath, result.stdout, result.stderr);
            const changedFiles = await listChangedFiles(input.repoPath);
            if (result.exitCode !== 0) {
                this.logger.warn("Codex CLI exited with a non-zero status", {
                    mode: input.mode,
                    exitCode: result.exitCode,
                });
                return {
                    decision: "needs_human_review",
                    summary: "Codex CLI could not complete the task.",
                    reason: truncate([summary, result.stderr, result.stdout].filter(Boolean).join("\n\n"), 2000),
                    changedFiles,
                };
            }
            if (changedFiles.length === 0) {
                this.logger.warn("Codex CLI completed without file changes", {
                    mode: input.mode,
                });
                return {
                    decision: "no_changes",
                    summary: summary || "Codex CLI reported completion without modifying files.",
                    reason: "Codex CLI completed successfully but left no working tree changes.",
                    changedFiles,
                };
            }
            this.logger.info("Codex CLI applied changes", {
                mode: input.mode,
                changedFiles,
            });
            return {
                decision: "applied",
                summary: summary || `Codex CLI completed the ${input.mode} pass.`,
                changedFiles,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error("Codex CLI invocation failed", {
                mode: input.mode,
                message,
            });
            return {
                decision: "needs_human_review",
                summary: "Codex CLI could not be started.",
                reason: truncate(message, 2000),
                changedFiles: await listChangedFiles(input.repoPath),
            };
        }
        finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }
    async prepareJiraImages(ticket, repoPath, signal) {
        if (!ticket.imageAttachments?.length) {
            return [];
        }
        const imageRoot = path.join(repoPath, ".jira-assets", ticket.key);
        await fs.mkdir(imageRoot, { recursive: true });
        await ensureGitExclude(repoPath, ".jira-assets/");
        const localPaths = await Promise.all(ticket.imageAttachments.map(async (attachment, index) => {
            const sanitizedName = sanitizeFilename(attachment.filename, index);
            const targetPath = path.join(imageRoot, sanitizedName);
            try {
                const response = await axios.get(attachment.contentUrl, {
                    responseType: "arraybuffer",
                    ...(signal ? { signal } : {}),
                    auth: {
                        username: this.config.JIRA_EMAIL,
                        password: this.config.JIRA_API_TOKEN,
                    },
                    timeout: 30000,
                });
                await fs.writeFile(targetPath, Buffer.from(new Uint8Array(response.data)));
                return targetPath;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn("Failed to download Jira image attachment", {
                    ticketKey: ticket.key,
                    filename: attachment.filename,
                    message,
                });
                return "";
            }
        }));
        return localPaths.filter(Boolean);
    }
}
function buildCodexPrompt(input) {
    const validationSummary = input.validation
        ? [
            "",
            "Latest validation failures:",
            ...input.validation.steps.map((step) => [
                `COMMAND: ${step.command}`,
                `SUCCESS: ${step.success}`,
                `EXIT CODE: ${step.exitCode ?? "unknown"}`,
                `STDOUT:\n${truncate(step.stdout, 4000) || "(empty)"}`,
                `STDERR:\n${truncate(step.stderr, 4000) || "(empty)"}`,
            ].join("\n")),
        ].join("\n\n")
        : "";
    return [
        "You are Codex working inside a git worktree created for a single Jira ticket.",
        "Inspect the repository directly before editing anything.",
        "Use repository search, file reads, git diff, and targeted validation commands as needed.",
        "Make the smallest complete code change that satisfies the ticket and acceptance criteria.",
        "Prefer fixing the actual user-facing surface mentioned in the ticket instead of nearby or similarly named screens.",
        "If there are multiple plausible surfaces, inspect all relevant callers/components before choosing.",
        "Do not commit, push, or open pull requests.",
        "Leave all changes in the working tree.",
        "End with a short plain-text summary of what you changed and any remaining risk.",
        "",
        `Mode: ${input.mode}`,
        `Repository path: ${input.repoPath}`,
        `Ticket key: ${input.ticket.key}`,
        `Ticket summary: ${input.ticket.summary}`,
        `Ticket description:\n${input.ticket.description || "(empty)"}`,
        `Acceptance criteria:\n${input.ticket.acceptanceCriteria ?? "(not explicitly provided)"}`,
        `Jira image attachments saved locally:\n${input.jiraImagePaths.join("\n") || "(none)"}`,
        `Recent human Jira comments:\n${input.ticket.recentHumanComments?.join("\n\n---\n\n") ?? "(none)"}`,
        validationSummary,
        "",
        "Before you finish:",
        "1. Verify the ticketed surface was actually edited or intentionally justified.",
        "2. Run focused checks when feasible.",
        "3. Summarize the exact affected files and behavior.",
    ].join("\n");
}
async function ensureGitExclude(repoPath, entry) {
    const gitDirResult = await execa("git", ["rev-parse", "--git-dir"], {
        cwd: repoPath,
        reject: false,
    });
    const gitDir = gitDirResult.exitCode === 0 && gitDirResult.stdout.trim()
        ? gitDirResult.stdout.trim()
        : ".git";
    const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(repoPath, gitDir);
    const excludePath = path.join(resolvedGitDir, "info", "exclude");
    let current = "";
    try {
        current = await fs.readFile(excludePath, "utf8");
    }
    catch {
        current = "";
    }
    if (current.split("\n").includes(entry)) {
        return;
    }
    const next = current.trimEnd()
        ? `${current.trimEnd()}\n${entry}\n`
        : `${entry}\n`;
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, next, "utf8");
}
function sanitizeFilename(filename, index) {
    const ext = path.extname(filename).slice(0, 10) || ".img";
    const basename = path.basename(filename, path.extname(filename)) || `image-${index + 1}`;
    const safeBase = basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `image-${index + 1}`;
    const hash = createHash("sha1").update(filename).digest("hex").slice(0, 8);
    return `${safeBase}-${hash}${ext}`;
}
async function readSummary(outputPath, stdout, stderr) {
    try {
        const content = (await fs.readFile(outputPath, "utf8")).trim();
        if (content) {
            return content;
        }
    }
    catch {
        // Fall back to process output below when the helper file is absent.
    }
    return truncate([stdout, stderr].filter(Boolean).join("\n\n").trim(), 2000);
}
async function listChangedFiles(repoPath) {
    const status = await execa("git", ["status", "--short", "--untracked-files=all"], {
        cwd: repoPath,
        reject: false,
    });
    if (status.exitCode !== 0 || !status.stdout.trim()) {
        return [];
    }
    return status.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
}
