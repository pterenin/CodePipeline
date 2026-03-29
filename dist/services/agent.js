import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { collectRepositoryContext, loadFilesByPath } from "../utils/files.js";
import { Logger } from "../utils/logger.js";
import { truncate } from "../utils/text.js";
export class AgentService {
    config;
    client;
    logger = new Logger("agent");
    constructor(config) {
        this.config = config;
        this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    }
    async implementTicket(ticket, repoPath, hooks) {
        this.logger.info("Starting implementation pass", {
            ticketKey: ticket.key,
            repoPath,
        });
        hooks?.onProgress?.("Collecting repository context.");
        const context = await this.loadContext(repoPath, ticket);
        hooks?.onProgress?.("Reviewing repository context.");
        const response = await this.requestChangesWithDiscovery({
            ticket,
            repoPath,
            context,
            mode: "implementation",
            ...(hooks ? { hooks } : {}),
        });
        hooks?.onProgress?.("Applying requested file changes.");
        return this.applyChangeResponse(repoPath, response);
    }
    async repairFromValidation(ticket, repoPath, validation) {
        this.logger.info("Starting repair pass", {
            ticketKey: ticket.key,
            repoPath,
        });
        const context = await this.loadContext(repoPath, ticket);
        const response = await this.requestChangesWithDiscovery({
            ticket,
            repoPath,
            context,
            mode: "repair",
            validation,
        });
        return this.applyChangeResponse(repoPath, response);
    }
    async loadContext(repoPath, ticket) {
        const context = await collectRepositoryContext(repoPath, this.config.OPENAI_MAX_CONTEXT_FILES, this.config.OPENAI_MAX_FILE_BYTES, this.config.OPENAI_MAX_SEARCH_RESULTS, `${ticket.summary}\n${ticket.description}\n${ticket.acceptanceCriteria ?? ""}`);
        this.logger.info("Loaded initial repository context", {
            topLevelEntries: context.topLevelEntries.length,
            catalogFiles: context.fileCatalog.length,
            searchQueries: context.discoveryQueries,
        });
        return context;
    }
    async requestChangesWithDiscovery(input) {
        let currentContext = input.context;
        for (let round = 1; round <= this.config.OPENAI_CONTEXT_ROUNDS; round += 1) {
            this.logger.info("Requesting agent decision", {
                mode: input.mode,
                round,
            });
            input.hooks?.onProgress?.(`Planning changes with the agent (${round}/${this.config.OPENAI_CONTEXT_ROUNDS}).`);
            const response = await this.requestAgentDecision({
                ...input,
                context: currentContext,
                round,
                maxRounds: this.config.OPENAI_CONTEXT_ROUNDS,
            });
            if (response.decision !== "request_more_context") {
                this.logger.info("Agent returned final decision", {
                    decision: response.decision,
                    summary: response.summary,
                });
                const normalizedFiles = response.decision === "apply_changes"
                    ? normalizeFileEdits(response.files)
                    : undefined;
                return {
                    decision: response.decision,
                    summary: response.summary,
                    ...(response.reason ? { reason: response.reason } : {}),
                    ...(normalizedFiles ? { files: normalizedFiles } : {}),
                };
            }
            const requestedPaths = (response.files ?? []).filter((item) => typeof item === "string");
            input.hooks?.onProgress?.("Gathering a few more files for the agent.");
            this.logger.info("Agent requested more context", {
                requestedFiles: requestedPaths,
                requestedQueries: response.queries ?? [],
            });
            const matchedFiles = currentContext.searchResults
                .filter((result) => (response.queries ?? []).includes(result.query))
                .flatMap((result) => result.matches);
            const extraFiles = await loadFilesByPath(input.repoPath, [...requestedPaths, ...matchedFiles], this.config.OPENAI_MAX_CONTEXT_FILES, this.config.OPENAI_MAX_FILE_BYTES);
            if (extraFiles.length === 0) {
                this.logger.warn("Agent requested additional context but no files could be loaded");
                return {
                    decision: "needs_human_review",
                    summary: response.summary,
                    reason: "The agent requested additional context, but no matching files could be loaded safely.",
                };
            }
            const requestedPathSet = new Set(extraFiles.map((file) => file.path));
            const prioritizedFiles = [
                ...extraFiles,
                ...currentContext.selectedFiles.filter((file) => !requestedPathSet.has(file.path)),
            ];
            currentContext = {
                ...currentContext,
                selectedFiles: prioritizedFiles.slice(0, this.config.OPENAI_MAX_CONTEXT_FILES),
            };
            input.hooks?.onProgress?.(`Loaded ${extraFiles.length} more file${extraFiles.length === 1 ? "" : "s"} for review.`);
            this.logger.info("Expanded active context", {
                loadedFiles: currentContext.selectedFiles.map((file) => file.path),
            });
        }
        this.logger.warn("Agent hit context round limit");
        return {
            decision: "needs_human_review",
            summary: "Context gathering limit reached.",
            reason: "The agent requested more context than allowed by the configured round limit.",
        };
    }
    async requestAgentDecision(input) {
        const prompt = buildPrompt(input);
        this.logger.info("Sending prompt to OpenAI", {
            mode: input.mode,
            round: input.round,
            model: this.config.OPENAI_MODEL,
        });
        const response = await this.client.responses.create({
            model: this.config.OPENAI_MODEL,
            input: prompt,
        });
        const text = response.output_text;
        const parsed = parseAgentDecision(text);
        if (!parsed) {
            this.logger.warn("OpenAI response could not be parsed as JSON");
            return {
                decision: "needs_human_review",
                summary: "Model response was not parseable as a change instruction.",
                reason: truncate(text || "(empty response)", 1000),
            };
        }
        return parsed;
    }
    async applyChangeResponse(repoPath, response) {
        if (response.decision === "needs_human_review") {
            this.logger.warn("Agent requested human review", {
                summary: response.summary,
            });
            return {
                decision: "needs_human_review",
                summary: response.summary,
                ...(response.reason ? { reason: response.reason } : {}),
                changedFiles: [],
            };
        }
        const fileEdits = response.files ?? [];
        if (fileEdits.length === 0) {
            this.logger.warn("Agent returned no file edits");
            return {
                decision: "no_changes",
                summary: response.summary,
                reason: "Model returned no file edits.",
                changedFiles: [],
            };
        }
        this.logger.info("Applying agent file edits", {
            files: fileEdits.map((file) => file.path),
        });
        const changedFiles = [];
        for (const fileEdit of fileEdits) {
            const normalizedPath = normalizeWorkspacePath(fileEdit.path);
            if (!normalizedPath) {
                return {
                    decision: "needs_human_review",
                    summary: response.summary,
                    reason: `Model returned an unsafe file path: ${fileEdit.path}`,
                    changedFiles: [],
                };
            }
            const fullPath = path.join(repoPath, normalizedPath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, fileEdit.content, "utf8");
            changedFiles.push(normalizedPath);
        }
        return {
            decision: "applied",
            summary: response.summary,
            changedFiles,
        };
    }
}
function buildPrompt(input) {
    const contextFiles = input.context.selectedFiles
        .map((file) => `FILE: ${file.path}\n---\n${file.content}\n---`)
        .join("\n\n");
    const searchSummary = input.context.searchResults
        .map((result) => `${result.query}: ${result.matches.join(", ")}`)
        .join("\n");
    const validationSummary = input.validation
        ? [
            "",
            "Validation output from the latest failed run:",
            ...input.validation.steps.map((step) => `COMMAND: ${step.command}\nSUCCESS: ${step.success}\nSTDOUT:\n${truncate(step.stdout, 4000)}\nSTDERR:\n${truncate(step.stderr, 4000)}`),
        ].join("\n\n")
        : "";
    return [
        "You are a conservative senior software engineer working inside a git repository.",
        "Your job is to make the smallest valid code change that satisfies the Jira ticket.",
        "You may request more context before producing code changes if the currently loaded files are not enough.",
        "If the requirements are ambiguous, risky, or cannot be satisfied confidently from the provided repository context, choose needs_human_review.",
        "Do not touch auth, billing, payments, migrations, secrets, infrastructure, or CI/CD concerns.",
        "Do not output explanations outside the required JSON object.",
        "",
        "Return valid JSON with this shape:",
        '{ "decision": "request_more_context" | "apply_changes" | "needs_human_review", "summary": "short summary", "reason": "optional reason", "files": ["optional file paths for more context requests"] | [{"path":"src/example.ts","content":"full replacement file content"}], "queries": ["optional discovery queries to inspect"] }',
        'When decision is "apply_changes", files must be an array of objects with "path" and the full replacement "content" for each file.',
        "Do not return git diffs or markdown fences.",
        "",
        `Mode: ${input.mode}`,
        `Context round: ${input.round} of ${input.maxRounds}`,
        `Repository path: ${input.repoPath}`,
        `Ticket key: ${input.ticket.key}`,
        `Ticket summary: ${input.ticket.summary}`,
        `Ticket description:\n${input.ticket.description || "(empty)"}`,
        `Acceptance criteria:\n${input.ticket.acceptanceCriteria ?? "(not explicitly provided)"}`,
        `Recent human Jira comments:\n${input.ticket.recentHumanComments?.join("\n\n---\n\n") ?? "(none)"}`,
        "",
        `Top-level repository entries: ${input.context.topLevelEntries.join(", ")}`,
        `Repository file catalog sample: ${input.context.fileCatalog.join(", ")}`,
        `Discovery queries: ${input.context.discoveryQueries.join(", ") || "(none)"}`,
        "Search results by query:",
        searchSummary || "(no matches found)",
        "",
        "Currently loaded repository context files:",
        contextFiles || "(no files captured)",
        validationSummary,
        "",
        "Context request rules:",
        "- Use request_more_context if you need more files before coding.",
        "- Request concrete repository file paths, not shell commands.",
        "- Only request files that appear in the repository file catalog or search results.",
        "- Prefer a focused set of files tied to the ticket.",
        "- Do not request more context if you already have enough to make a safe decision.",
        "",
        "Change rules:",
        "- Return only the files you want to create or replace.",
        "- Each returned file must contain the full final content.",
        "- Keep the edit set small and conservative.",
        "- Preserve existing style and surrounding code patterns.",
    ].join("\n");
}
function parseAgentDecision(text) {
    const normalized = text.trim();
    const candidates = [
        normalized,
        normalized
            .replace(/^```json\s*/i, "")
            .replace(/```$/, "")
            .trim(),
        normalized
            .replace(/^```\s*/i, "")
            .replace(/```$/, "")
            .trim(),
    ];
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (!parsed ||
                typeof parsed.summary !== "string" ||
                typeof parsed.decision !== "string") {
                continue;
            }
            if (parsed.decision !== "apply_changes" &&
                parsed.decision !== "needs_human_review" &&
                parsed.decision !== "request_more_context") {
                continue;
            }
            return parsed;
        }
        catch {
            continue;
        }
    }
    return null;
}
function normalizeFileEdits(files) {
    if (!Array.isArray(files)) {
        return [];
    }
    return files
        .filter((file) => {
        return Boolean(file &&
            typeof file === "object" &&
            "path" in file &&
            "content" in file &&
            typeof file.path === "string" &&
            typeof file.content === "string");
    })
        .map((file) => ({
        path: file.path,
        content: file.content,
    }));
}
function normalizeWorkspacePath(filePath) {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (!normalized || normalized.includes("..")) {
        return "";
    }
    return normalized;
}
