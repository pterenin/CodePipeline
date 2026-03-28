import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";
import OpenAI from "openai";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem
} from "openai/resources/responses/responses";

import type { AppConfig } from "../config.js";
import type {
  AgentRunResult,
  JiraTicket,
  RepositoryContext,
  ValidationResult
} from "../types.js";
import { collectRepositoryContext } from "../utils/files.js";
import { Logger } from "../utils/logger.js";
import { truncate } from "../utils/text.js";

const MAX_TOOL_STEPS_FLOOR = 8;
const DEFAULT_LIST_LIMIT = 60;
const DEFAULT_SEARCH_LIMIT = 20;

export class AgentService {
  private readonly client: OpenAI;
  private readonly logger = new Logger("agent");

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  async implementTicket(
    ticket: JiraTicket,
    repoPath: string
  ): Promise<AgentRunResult> {
    this.logger.info("Starting implementation pass", {
      ticketKey: ticket.key,
      repoPath
    });

    const context = await this.loadContext(repoPath, ticket);
    return this.runToolCallingSession({
      ticket,
      repoPath,
      context,
      mode: "implementation"
    });
  }

  async repairFromValidation(
    ticket: JiraTicket,
    repoPath: string,
    validation: ValidationResult
  ): Promise<AgentRunResult> {
    this.logger.info("Starting repair pass", {
      ticketKey: ticket.key,
      repoPath
    });

    const context = await this.loadContext(repoPath, ticket);
    return this.runToolCallingSession({
      ticket,
      repoPath,
      context,
      mode: "repair",
      validation
    });
  }

  private async loadContext(
    repoPath: string,
    ticket: JiraTicket
  ): Promise<RepositoryContext> {
    const context = await collectRepositoryContext(
      repoPath,
      this.config.OPENAI_MAX_CONTEXT_FILES,
      this.config.OPENAI_MAX_FILE_BYTES,
      this.config.OPENAI_MAX_SEARCH_RESULTS,
      `${ticket.summary}\n${ticket.description}\n${ticket.acceptanceCriteria ?? ""}`
    );

    this.logger.info("Loaded initial repository context", {
      topLevelEntries: context.topLevelEntries.length,
      catalogFiles: context.fileCatalog.length,
      searchQueries: context.discoveryQueries
    });

    return context;
  }

  private async runToolCallingSession(input: {
    ticket: JiraTicket;
    repoPath: string;
    context: RepositoryContext;
    mode: "implementation" | "repair";
    validation?: ValidationResult;
  }): Promise<AgentRunResult> {
    const changedFiles = new Set<string>();
    const tools = buildAgentTools();
    const maxToolSteps = Math.max(this.config.OPENAI_CONTEXT_ROUNDS * 4, MAX_TOOL_STEPS_FLOOR);
    const instructions = buildAgentInstructions(input.mode, maxToolSteps);
    const initialInput = buildInitialInput(input);

    this.logger.info("Starting tool-calling agent session", {
      mode: input.mode,
      model: this.config.OPENAI_MODEL,
      maxToolSteps
    });

    let response = await this.client.responses.create({
      model: this.config.OPENAI_MODEL,
      instructions,
      input: initialInput,
      tools,
      tool_choice: "auto"
    });

    for (let step = 1; step <= maxToolSteps; step += 1) {
      const toolCalls = response.output.filter(
        (item): item is ResponseFunctionToolCall => item.type === "function_call"
      );

      if (toolCalls.length === 0) {
        return finalizeAgentResponse(response.output_text, Array.from(changedFiles));
      }

      this.logger.info("Agent requested tool calls", {
        mode: input.mode,
        step,
        toolCalls: toolCalls.map((call) => call.name)
      });

      const toolOutputs: ResponseInputItem[] = [];

      for (const toolCall of toolCalls) {
        const toolResult = await this.executeToolCall(toolCall, input.repoPath, changedFiles);
        toolOutputs.push({
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: JSON.stringify(toolResult)
        });
      }

      response = await this.client.responses.create({
        model: this.config.OPENAI_MODEL,
        previous_response_id: response.id,
        instructions,
        input: toolOutputs,
        tools,
        tool_choice: "auto"
      });
    }

    this.logger.warn("Agent exceeded tool-calling step limit", {
      mode: input.mode,
      maxToolSteps
    });

    return {
      decision: "needs_human_review",
      summary: "Tool-calling limit reached.",
      reason: "The agent exceeded the maximum number of interactive tool steps.",
      changedFiles: Array.from(changedFiles)
    };
  }

  private async executeToolCall(
    toolCall: ResponseFunctionToolCall,
    repoPath: string,
    changedFiles: Set<string>
  ): Promise<Record<string, unknown>> {
    let parsedArguments: Record<string, unknown>;

    try {
      parsedArguments = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
    } catch {
      return {
        ok: false,
        error: `Tool arguments for ${toolCall.name} were not valid JSON.`
      };
    }

    this.logger.info("Executing agent tool", {
      tool: toolCall.name,
      arguments: truncate(JSON.stringify(parsedArguments), 1000)
    });

    try {
      switch (toolCall.name) {
        case "list_files":
          return await this.listFilesTool(repoPath, parsedArguments);
        case "search_repository":
          return await this.searchRepositoryTool(repoPath, parsedArguments);
        case "read_file":
          return await this.readFileTool(repoPath, parsedArguments);
        case "apply_file_edits":
          return await this.applyFileEditsTool(repoPath, parsedArguments, changedFiles);
        case "write_file":
          return await this.writeFileTool(repoPath, parsedArguments, changedFiles);
        default:
          return {
            ok: false,
            error: `Unknown tool requested: ${toolCall.name}`
          };
      }
    } catch (error) {
      this.logger.warn(`Agent tool ${toolCall.name} failed`, error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown tool execution error"
      };
    }
  }

  private async listFilesTool(
    repoPath: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const pathPrefix = typeof args.pathPrefix === "string" ? normalizeWorkspacePath(args.pathPrefix) : "";
    const limit = clampNumber(args.limit, DEFAULT_LIST_LIMIT, 1, 200);

    const allFiles = await listRepositoryFiles(repoPath);
    const files = allFiles
      .filter((filePath) => !pathPrefix || filePath.startsWith(pathPrefix))
      .slice(0, limit);

    return {
      ok: true,
      pathPrefix: pathPrefix || ".",
      totalMatches: files.length,
      files
    };
  }

  private async searchRepositoryTool(
    repoPath: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return {
        ok: false,
        error: "search_repository requires a non-empty query."
      };
    }

    const limit = clampNumber(args.limit, DEFAULT_SEARCH_LIMIT, 1, 100);

    const contentResult = await execa(
      "rg",
      [
        "-n",
        "--hidden",
        "-g",
        "!.git",
        "--glob",
        "!node_modules",
        "--glob",
        "!dist",
        "--glob",
        "!build",
        "--glob",
        "!.next",
        "--glob",
        "!coverage",
        "--glob",
        "!.turbo",
        query
      ],
      {
        cwd: repoPath,
        reject: false
      }
    );

    const pathResult = await execa(
      "rg",
      ["--files", "--hidden", "-g", "!.git", "-g", `*${query}*`],
      {
        cwd: repoPath,
        reject: false
      }
    );

    const contentMatches = parseSearchMatches(contentResult.stdout, limit);
    const pathMatches = pathResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => ({ path: filePath }))
      .slice(0, limit);

    return {
      ok: true,
      query,
      contentMatches,
      pathMatches
    };
  }

  private async readFileTool(
    repoPath: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const normalizedPath = typeof args.path === "string" ? normalizeWorkspacePath(args.path) : "";
    if (!normalizedPath) {
      return {
        ok: false,
        error: "read_file requires a safe relative file path."
      };
    }

    const fullPath = path.join(repoPath, normalizedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats?.isFile()) {
      return {
        ok: false,
        error: `File not found: ${normalizedPath}`
      };
    }

    const content = await fs.readFile(fullPath, "utf8");
    const truncatedContent = content.slice(0, this.config.OPENAI_MAX_FILE_BYTES);

    return {
      ok: true,
      path: normalizedPath,
      truncated: truncatedContent.length < content.length,
      content: truncatedContent
    };
  }

  private async applyFileEditsTool(
    repoPath: string,
    args: Record<string, unknown>,
    changedFiles: Set<string>
  ): Promise<Record<string, unknown>> {
    const normalizedPath = typeof args.path === "string" ? normalizeWorkspacePath(args.path) : "";
    if (!normalizedPath) {
      return {
        ok: false,
        error: "apply_file_edits requires a safe relative file path."
      };
    }

    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (edits.length === 0) {
      return {
        ok: false,
        error: "apply_file_edits requires at least one edit."
      };
    }

    const fullPath = path.join(repoPath, normalizedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats?.isFile()) {
      return {
        ok: false,
        error: `File not found: ${normalizedPath}`
      };
    }

    let content = await fs.readFile(fullPath, "utf8");
    const applied: Array<{ oldTextPreview: string; replacedCount: number }> = [];

    for (const rawEdit of edits) {
      if (!rawEdit || typeof rawEdit !== "object") {
        return {
          ok: false,
          error: "Each edit must be an object."
        };
      }

      const oldText = "oldText" in rawEdit && typeof rawEdit.oldText === "string" ? rawEdit.oldText : "";
      const newText = "newText" in rawEdit && typeof rawEdit.newText === "string" ? rawEdit.newText : "";
      const replaceAll = "replaceAll" in rawEdit && typeof rawEdit.replaceAll === "boolean" ? rawEdit.replaceAll : false;

      if (!oldText) {
        return {
          ok: false,
          error: "Each edit must include non-empty oldText."
        };
      }

      const matches = countOccurrences(content, oldText);
      if (matches === 0) {
        return {
          ok: false,
          error: `Could not find target text in ${normalizedPath}: ${truncate(oldText, 160)}`
        };
      }

      if (matches > 1 && !replaceAll) {
        return {
          ok: false,
          error: `Target text appears ${matches} times in ${normalizedPath}; set replaceAll to true or use a more specific snippet.`
        };
      }

      content = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText);
      applied.push({
        oldTextPreview: truncate(oldText, 120),
        replacedCount: replaceAll ? matches : 1
      });
    }

    await fs.writeFile(fullPath, content, "utf8");
    changedFiles.add(normalizedPath);

    return {
      ok: true,
      path: normalizedPath,
      applied
    };
  }

  private async writeFileTool(
    repoPath: string,
    args: Record<string, unknown>,
    changedFiles: Set<string>
  ): Promise<Record<string, unknown>> {
    const normalizedPath = typeof args.path === "string" ? normalizeWorkspacePath(args.path) : "";
    const content = typeof args.content === "string" ? args.content : "";
    const overwrite = typeof args.overwrite === "boolean" ? args.overwrite : false;

    if (!normalizedPath) {
      return {
        ok: false,
        error: "write_file requires a safe relative file path."
      };
    }

    if (!content) {
      return {
        ok: false,
        error: "write_file requires non-empty content."
      };
    }

    const fullPath = path.join(repoPath, normalizedPath);
    const exists = await fs.stat(fullPath).then(() => true).catch(() => false);
    if (exists && !overwrite) {
      return {
        ok: false,
        error: `File already exists: ${normalizedPath}. Use overwrite=true only when a full rewrite is intentionally required.`
      };
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
    changedFiles.add(normalizedPath);

    return {
      ok: true,
      path: normalizedPath,
      bytesWritten: content.length
    };
  }
}

function buildAgentTools(): FunctionTool[] {
  return [
    {
      type: "function",
      name: "list_files",
      description: "List repository files, optionally filtered by a path prefix.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pathPrefix: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 200 }
        }
      }
    },
    {
      type: "function",
      name: "search_repository",
      description: "Search the repository by content and filename using a ripgrep-style query.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        },
        required: ["query"]
      }
    },
    {
      type: "function",
      name: "read_file",
      description: "Read a repository file to inspect its current contents.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    },
    {
      type: "function",
      name: "apply_file_edits",
      description: "Apply targeted string replacements to an existing file. Prefer this over rewriting full files.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          edits: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" },
                replaceAll: { type: "boolean" }
              },
              required: ["oldText", "newText"]
            }
          }
        },
        required: ["path", "edits"]
      }
    },
    {
      type: "function",
      name: "write_file",
      description: "Create a new file or fully rewrite an existing file when a targeted edit is not practical.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          overwrite: { type: "boolean" }
        },
        required: ["path", "content"]
      }
    }
  ];
}

function buildAgentInstructions(
  mode: "implementation" | "repair",
  maxToolSteps: number
): string {
  return [
    "You are a conservative senior software engineer working inside a git repository.",
    "Use tools to inspect the codebase before making changes.",
    "Prefer list_files, search_repository, and read_file to discover relevant code.",
    "Prefer apply_file_edits for targeted edits. Use write_file only for new files or deliberate full rewrites.",
    "Keep the edit set minimal and consistent with existing code style.",
    "Do not touch auth, billing, payments, migrations, secrets, infrastructure, or CI/CD concerns.",
    "If the requirements are ambiguous, risky, or cannot be satisfied safely, do not edit further and finish with needs_human_review.",
    "Do not invent files or APIs without first inspecting relevant repository files.",
    "When you are done, respond with valid JSON only and no markdown fences.",
    'Final JSON shape: { "decision": "apply_changes" | "needs_human_review", "summary": "short summary", "reason": "optional reason" }',
    "If you made safe code edits, use decision=apply_changes.",
    "If you could not complete the work safely, use decision=needs_human_review.",
    `Mode: ${mode}`,
    `Maximum tool steps: ${maxToolSteps}`
  ].join("\n");
}

function buildInitialInput(input: {
  ticket: JiraTicket;
  repoPath: string;
  context: RepositoryContext;
  mode: "implementation" | "repair";
  validation?: ValidationResult;
}): string {
  const initialFiles = input.context.selectedFiles
    .map((file) => `FILE: ${file.path}\n---\n${file.content}\n---`)
    .join("\n\n");

  const searchSummary = input.context.searchResults
    .map((result) => `${result.query}: ${result.matches.join(", ")}`)
    .join("\n");

  const validationSummary = input.validation
    ? [
        "",
        "Validation output from the latest failed run:",
        ...input.validation.steps.map(
          (step) =>
            `COMMAND: ${step.command}\nSUCCESS: ${step.success}\nSTDOUT:\n${truncate(step.stdout, 4000)}\nSTDERR:\n${truncate(step.stderr, 4000)}`
        )
      ].join("\n\n")
    : "";

  return [
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
    "Initial search results:",
    searchSummary || "(no matches found)",
    "",
    "Initial file snippets:",
    initialFiles || "(no initial files loaded)",
    validationSummary
  ].join("\n");
}

function finalizeAgentResponse(
  text: string,
  changedFiles: string[]
): AgentRunResult {
  const parsed = parseFinalDecision(text);

  if (!parsed) {
    return {
      decision: "needs_human_review",
      summary: "Model response was not parseable as a final tool-calling decision.",
      reason: truncate(text || "(empty response)", 1000),
      changedFiles
    };
  }

  if (parsed.decision === "needs_human_review") {
    return {
      decision: "needs_human_review",
      summary: parsed.summary,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      changedFiles
    };
  }

  if (changedFiles.length === 0) {
    return {
      decision: "no_changes",
      summary: parsed.summary,
      reason: parsed.reason ?? "The model finished without applying any file edits.",
      changedFiles: []
    };
  }

  return {
    decision: "applied",
    summary: parsed.summary,
    changedFiles
  };
}

function parseFinalDecision(
  text: string
): { decision: "apply_changes" | "needs_human_review"; summary: string; reason?: string } | null {
  const normalized = text.trim();
  const candidates = [
    normalized,
    normalized.replace(/^```json\s*/i, "").replace(/```$/, "").trim(),
    normalized.replace(/^```\s*/i, "").replace(/```$/, "").trim()
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        decision?: string;
        summary?: string;
        reason?: string;
      };

      if (
        parsed &&
        typeof parsed.summary === "string" &&
        (parsed.decision === "apply_changes" || parsed.decision === "needs_human_review")
      ) {
        return {
          decision: parsed.decision,
          summary: parsed.summary,
          ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {})
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function listRepositoryFiles(repoPath: string): Promise<string[]> {
  const result = await execa("rg", ["--files", "--hidden", "-g", "!.git"], {
    cwd: repoPath,
    reject: false
  });

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && isAllowedRepositoryPath(line));
}

function parseSearchMatches(
  output: string,
  limit: number
): Array<{ path: string; line: number; preview: string }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!match) {
        return null;
      }

      return {
        path: match[1] ?? "",
        line: Number(match[2] ?? "0"),
        preview: truncate((match[3] ?? "").trim(), 240)
      };
    })
    .filter((value): value is { path: string; line: number; preview: string } => Boolean(value))
    .slice(0, limit);
}

function normalizeWorkspacePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized || normalized.includes("..")) {
    return "";
  }

  return normalized;
}

function isAllowedRepositoryPath(filePath: string): boolean {
  const normalized = normalizeWorkspacePath(filePath);
  if (!normalized || normalized.startsWith(".git/") || normalized === ".env") {
    return false;
  }

  const rootSegment = normalized.split("/")[0] ?? "";
  if (["node_modules", "dist", "build", "coverage", ".next", ".turbo"].includes(rootSegment)) {
    return false;
  }

  return true;
}

function clampNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (true) {
    const nextIndex = haystack.indexOf(needle, index);
    if (nextIndex === -1) {
      return count;
    }

    count += 1;
    index = nextIndex + needle.length;
  }
}
