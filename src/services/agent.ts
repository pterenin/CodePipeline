import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";
import OpenAI from "openai";

import type { AppConfig } from "../config.js";
import type {
  AgentPatchResponse,
  AgentRunResult,
  JiraTicket,
  RepositoryContext,
  ValidationResult
} from "../types.js";
import { collectRepositoryContext } from "../utils/files.js";
import { normalizeWhitespace, truncate } from "../utils/text.js";

export class AgentService {
  private readonly client: OpenAI;

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  async implementTicket(ticket: JiraTicket, repoPath: string): Promise<AgentRunResult> {
    const context = await this.loadContext(repoPath);
    const response = await this.requestPatch({
      ticket,
      repoPath,
      context,
      mode: "implementation"
    });

    return this.applyPatchResponse(repoPath, response);
  }

  async repairFromValidation(
    ticket: JiraTicket,
    repoPath: string,
    validation: ValidationResult
  ): Promise<AgentRunResult> {
    const context = await this.loadContext(repoPath);
    const response = await this.requestPatch({
      ticket,
      repoPath,
      context,
      mode: "repair",
      validation
    });

    return this.applyPatchResponse(repoPath, response);
  }

  private async loadContext(repoPath: string): Promise<RepositoryContext> {
    return collectRepositoryContext(
      repoPath,
      this.config.OPENAI_MAX_CONTEXT_FILES,
      this.config.OPENAI_MAX_FILE_BYTES
    );
  }

  private async requestPatch(input: {
    ticket: JiraTicket;
    repoPath: string;
    context: RepositoryContext;
    mode: "implementation" | "repair";
    validation?: ValidationResult;
  }): Promise<AgentPatchResponse> {
    const prompt = buildPrompt(input);
    const response = await this.client.responses.create({
      model: this.config.OPENAI_MODEL,
      input: prompt
    });

    const text = response.output_text;
    const parsed = parseAgentResponse(text);

    if (!parsed) {
      return {
        decision: "needs_human_review",
        summary: "Model response was not parseable as a patch instruction.",
        reason: truncate(text || "(empty response)", 1000)
      };
    }

    return parsed;
  }

  private async applyPatchResponse(repoPath: string, response: AgentPatchResponse): Promise<AgentRunResult> {
    if (response.decision === "needs_human_review") {
      return {
        decision: "needs_human_review",
        summary: response.summary,
        ...(response.reason ? { reason: response.reason } : {}),
        changedFiles: []
      };
    }

    if (!response.patch || !normalizeWhitespace(response.patch)) {
      return {
        decision: "no_changes",
        summary: response.summary,
        reason: "Model returned no patch content.",
        changedFiles: []
      };
    }

    const patchFilePath = path.join(repoPath, `.ai-patch-${Date.now()}.diff`);
    await fs.writeFile(patchFilePath, response.patch, "utf8");

    const applyResult = await execa("git", ["apply", "--reject", "--whitespace=fix", patchFilePath], {
      cwd: repoPath,
      reject: false
    });

    await fs.rm(patchFilePath, { force: true });

    if (applyResult.exitCode !== 0) {
      return {
        decision: "needs_human_review",
        summary: response.summary,
        reason: truncate(
          `Patch could not be applied.\nSTDOUT:\n${applyResult.stdout}\nSTDERR:\n${applyResult.stderr}`,
          3000
        ),
        changedFiles: []
      };
    }

    const statusResult = await execa("git", ["status", "--short"], {
      cwd: repoPath
    });

    const changedFiles = statusResult.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^[A-Z?]+\s+/, ""))
      .filter(Boolean);

    return {
      decision: changedFiles.length > 0 ? "applied" : "no_changes",
      summary: response.summary,
      changedFiles
    };
  }
}

function buildPrompt(input: {
  ticket: JiraTicket;
  repoPath: string;
  context: RepositoryContext;
  mode: "implementation" | "repair";
  validation?: ValidationResult;
}): string {
  const contextFiles = input.context.selectedFiles
    .map((file) => `FILE: ${file.path}\n---\n${file.content}\n---`)
    .join("\n\n");

  const validationSummary = input.validation
    ? [
        "",
        "Validation output from the latest failed run:",
        ...input.validation.steps.map(
          (step) =>
            `COMMAND: ${step.command}\nSUCCESS: ${step.success}\nSTDOUT:\n${truncate(
              step.stdout,
              4000
            )}\nSTDERR:\n${truncate(step.stderr, 4000)}`
        )
      ].join("\n\n")
    : "";

  return [
    "You are a conservative senior software engineer working inside a git repository.",
    "Your job is to make the smallest valid code change that satisfies the Jira ticket.",
    "If the requirements are ambiguous, risky, or cannot be satisfied confidently from the provided repository context, choose needs_human_review.",
    "Do not touch auth, billing, payments, migrations, secrets, infrastructure, or CI/CD concerns.",
    "Do not output explanations outside the required JSON object.",
    "",
    "Return valid JSON with this shape:",
    '{ "decision": "apply_patch" | "needs_human_review", "summary": "short summary", "reason": "optional reason", "patch": "unified diff patch when decision is apply_patch" }',
    "",
    `Mode: ${input.mode}`,
    `Repository path: ${input.repoPath}`,
    `Ticket key: ${input.ticket.key}`,
    `Ticket summary: ${input.ticket.summary}`,
    `Ticket description:\n${input.ticket.description || "(empty)"}`,
    `Acceptance criteria:\n${input.ticket.acceptanceCriteria ?? "(not explicitly provided)"}`,
    "",
    `Top-level repository entries: ${input.context.topLevelEntries.join(", ")}`,
    "",
    "Repository context files:",
    contextFiles || "(no files captured)",
    validationSummary,
    "",
    "Unified diff requirements:",
    "- Use paths relative to repository root.",
    "- Include enough context for git apply.",
    "- Only change files needed for the task.",
    "- Prefer one small patch over broad refactors.",
    "- If no safe patch is possible, choose needs_human_review."
  ].join("\n");
}

function parseAgentResponse(text: string): AgentPatchResponse | null {
  const normalized = text.trim();
  const candidates = [
    normalized,
    normalized.replace(/^```json\s*/i, "").replace(/```$/, "").trim(),
    normalized.replace(/^```\s*/i, "").replace(/```$/, "").trim()
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as AgentPatchResponse;
      if (!parsed || typeof parsed.summary !== "string" || typeof parsed.decision !== "string") {
        continue;
      }

      if (parsed.decision !== "apply_patch" && parsed.decision !== "needs_human_review") {
        continue;
      }

      return parsed;
    } catch {
      continue;
    }
  }

  return null;
}
