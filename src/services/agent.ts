import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import axios from "axios";
import { execa } from "execa";

import type { AppConfig } from "../config.js";
import type {
  AgentRunResult,
  ImplementationReviewResult,
  JiraTicket,
  ValidationResult
} from "../types.js";
import { Logger } from "../utils/logger.js";
import {
  collectTicketTextSources,
  extractLikelyRepoFileReferences,
  formatJiraCommentsForPrompt
} from "../utils/ticket-context.js";
import { truncate } from "../utils/text.js";

export class AgentService {
  private readonly logger = new Logger("agent");
  private atlassianMcpAvailability?: Promise<boolean>;

  constructor(private readonly config: AppConfig) {}

  async implementTicket(
    ticket: JiraTicket,
    repoPath: string,
    hooks?: {
      onProgress?: (message: string) => void;
      signal?: AbortSignal;
    } & {
      reviewFindingsPath?: string;
    }
  ): Promise<AgentRunResult> {
    hooks?.onProgress?.("Launching Codex CLI to implement the ticket from the documented context.");
    return this.runCodex({
      ticket,
      repoPath,
      mode: "implementation",
      ...(hooks?.reviewFindingsPath ? { reviewFindingsPath: hooks.reviewFindingsPath } : {}),
      ...(hooks ? { hooks } : {})
    });
  }

  async documentTicketContext(
    ticket: JiraTicket,
    repoPath: string,
    hooks?: {
      onProgress?: (message: string) => void;
      signal?: AbortSignal;
    }
  ): Promise<AgentRunResult> {
    hooks?.onProgress?.(
      "Launching Codex CLI to analyze the ticket and refresh its markdown context file."
    );
    return this.runCodex({
      ticket,
      repoPath,
      mode: "context",
      ...(hooks ? { hooks } : {})
    });
  }

  async repairFromValidation(
    ticket: JiraTicket,
    repoPath: string,
    validation: ValidationResult,
    signal?: AbortSignal
  ): Promise<AgentRunResult> {
    return this.runCodex({
      ticket,
      repoPath,
      mode: "repair",
      validation,
      ...(signal ? { signal } : {})
    });
  }

  async reviewTicketImplementation(
    ticket: JiraTicket,
    repoPath: string,
    hooks?: {
      onProgress?: (message: string) => void;
      signal?: AbortSignal;
    }
  ): Promise<ImplementationReviewResult> {
    const reviewPath = buildImplementationReviewPath(ticket.key);
    hooks?.onProgress?.("Launching a fresh Codex review pass against the implemented ticket.");

    const run = await this.runCodex({
      ticket,
      repoPath,
      mode: "review",
      ...(hooks ? { hooks } : {})
    });

    if (run.decision === "needs_human_review") {
      return {
        decision: "needs_human_review",
        summary: run.summary,
        findings: [],
        reviewPath,
        changedFiles: run.changedFiles,
        ...(run.reason ? { reason: run.reason } : {})
      };
    }

    const parsedReview = await readImplementationReview(repoPath, reviewPath);
    if (!parsedReview) {
      return {
        decision: "needs_human_review",
        summary: "Implementation review did not produce a parseable review document.",
        findings: [],
        reviewPath,
        changedFiles: run.changedFiles,
        reason: "Expected a structured review markdown file with a decision and findings."
      };
    }

    return {
      decision: parsedReview.decision,
      summary: parsedReview.summary,
      findings: parsedReview.findings,
      reviewPath,
      changedFiles: run.changedFiles
    };
  }

  private async runCodex(input: {
    ticket: JiraTicket;
    repoPath: string;
    mode: "context" | "implementation" | "review" | "repair";
    validation?: ValidationResult;
    reviewFindingsPath?: string;
    hooks?: {
      onProgress?: (message: string) => void;
      signal?: AbortSignal;
    };
    signal?: AbortSignal;
  }): Promise<AgentRunResult> {
    const signal = input.signal ?? input.hooks?.signal;
    const ticketContextPath = buildTicketContextPath(input.ticket.key);
    const visualReviewPlanPath = buildVisualReviewPlanPath(input.ticket.key);
    const visualReviewReportPath = buildVisualReviewReportPath(input.ticket.key);
    const jiraAssets = await this.prepareJiraAssets(input.ticket, input.repoPath, signal);
    const atlassianMcpAvailable = await this.isAtlassianMcpAvailable();
    const repoContextPaths = await discoverRepoContextPaths(
      input.ticket,
      input.repoPath,
      this.config.GITHUB_REPO
    );
    const prompt = buildCodexPrompt({
      ...input,
      ticketContextPath,
      visualReviewPlanPath,
      visualReviewReportPath,
      atlassianMcpEnabled: this.config.CODEX_USE_ATLASSIAN_MCP,
      atlassianMcpAvailable,
      jiraImagePaths: jiraAssets.imagePaths,
      jiraHtmlExamplePaths: jiraAssets.htmlExamplePaths,
      repoContextPaths,
      inlineHtmlExamples: extractInlineHtmlExamples(input.ticket),
      ...(jiraAssets.manifestPath ? { jiraAssetManifestPath: jiraAssets.manifestPath } : {})
    });
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-run-"));
    const outputPath = path.join(tempDir, "last-message.txt");

    this.logger.info("Running Codex CLI", {
      mode: input.mode,
      repoPath: input.repoPath,
      model: this.config.OPENAI_MODEL
    });

    input.hooks?.onProgress?.(
      input.mode === "context"
        ? "Codex is inspecting the ticket, comments, assets, and repository to refresh the ticket markdown."
        : "Codex is inspecting the repository and making changes."
    );

    try {
      const result = await execa(
        this.config.CODEX_CLI_PATH,
        buildCodexExecArgs({
          model: this.config.OPENAI_MODEL,
          outputPath,
          prompt,
          ...(this.config.CODEX_PROFILE ? { profile: this.config.CODEX_PROFILE } : {})
        }),
        {
          cwd: input.repoPath,
          reject: false,
          ...(signal ? { cancelSignal: signal } : {}),
          env: {
            ...process.env,
            OPENAI_API_KEY: this.config.OPENAI_API_KEY
          }
        }
      );

      const summary = await readSummary(outputPath, result.stdout, result.stderr);
      const changedFiles = await listChangedFiles(input.repoPath);

      if (result.exitCode !== 0) {
        this.logger.warn("Codex CLI exited with a non-zero status", {
          mode: input.mode,
          exitCode: result.exitCode
        });
        return {
          decision: "needs_human_review",
          summary: "Codex CLI could not complete the task.",
          reason: truncate(
            [summary, result.stderr, result.stdout].filter(Boolean).join("\n\n"),
            2000
          ),
          changedFiles
        };
      }

      if (changedFiles.length === 0) {
        this.logger.warn("Codex CLI completed without file changes", {
          mode: input.mode
        });
        return {
          decision: "no_changes",
          summary: summary || "Codex CLI reported completion without modifying files.",
          reason: "Codex CLI completed successfully but left no working tree changes.",
          changedFiles
        };
      }

      this.logger.info("Codex CLI applied changes", {
        mode: input.mode,
        changedFiles
      });

      return {
        decision: "applied",
        summary: summary || `Codex CLI completed the ${input.mode} pass.`,
        changedFiles
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("Codex CLI invocation failed", {
        mode: input.mode,
        message
      });
      return {
        decision: "needs_human_review",
        summary: "Codex CLI could not be started.",
        reason: truncate(message, 2000),
        changedFiles: await listChangedFiles(input.repoPath)
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async isAtlassianMcpAvailable(): Promise<boolean> {
    if (!this.config.CODEX_USE_ATLASSIAN_MCP) {
      return false;
    }

    if (!this.atlassianMcpAvailability) {
      this.atlassianMcpAvailability = (async () => {
        const args = [
          ...(this.config.CODEX_PROFILE ? ["--profile", this.config.CODEX_PROFILE] : []),
          "mcp",
          "get",
          "atlassian"
        ];
        const result = await execa(this.config.CODEX_CLI_PATH, args, {
          reject: false,
          env: {
            ...process.env,
            OPENAI_API_KEY: this.config.OPENAI_API_KEY
          }
        });

        return result.exitCode === 0;
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("Could not confirm Atlassian MCP availability for Codex CLI", {
          message
        });
        return false;
      });
    }

    return this.atlassianMcpAvailability;
  }

  private async prepareJiraAssets(
    ticket: JiraTicket,
    repoPath: string,
    signal?: AbortSignal
  ): Promise<{ imagePaths: string[]; htmlExamplePaths: string[]; manifestPath?: string }> {
    const imageAttachments = ticket.imageAttachments ?? [];
    const htmlAttachments = ticket.htmlAttachments ?? [];

    if (imageAttachments.length === 0 && htmlAttachments.length === 0) {
      return { imagePaths: [], htmlExamplePaths: [] };
    }

    const imageRoot = path.join(repoPath, ".jira-assets", ticket.key);
    await fs.mkdir(imageRoot, { recursive: true });
    await ensureGitExclude(repoPath, ".jira-assets/");

    const imagePaths = (
      await Promise.all(
        imageAttachments.map(async (attachment, index) => {
          const sanitizedName = sanitizeFilename(attachment.filename, index);
          const targetPath = path.join(imageRoot, sanitizedName);

          try {
            await this.downloadJiraAttachment(attachment.contentUrl, targetPath, signal);
            return targetPath;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn("Failed to download Jira image attachment", {
              ticketKey: ticket.key,
              filename: attachment.filename,
              message
            });
            return "";
          }
        })
      )
    ).filter(Boolean);

    const htmlExamplePaths = (
      await Promise.all(
        htmlAttachments.map(async (attachment, index) => {
          const sanitizedName = sanitizeFilename(
            attachment.filename,
            imageAttachments.length + index
          );
          const targetPath = path.join(imageRoot, sanitizedName);

          try {
            await this.downloadJiraAttachment(attachment.contentUrl, targetPath, signal);
            return targetPath;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn("Failed to download Jira HTML attachment", {
              ticketKey: ticket.key,
              filename: attachment.filename,
              message
            });
            return "";
          }
        })
      )
    ).filter(Boolean);

    const manifestPath = path.join(imageRoot, "README.txt");
    const manifestBody = [
      `Jira assets for ${ticket.key}`,
      "",
      "These files were downloaded from Jira attachments so the implementation agent can inspect screenshots and HTML examples locally.",
      "Open image files directly when visual context matters. Open HTML files directly when the ticket includes example markup.",
      "",
      "Image attachments:",
      ...(imagePaths.length > 0
        ? imagePaths.map((filePath, index) => `${index + 1}. ${filePath}`)
        : ["(none)"]),
      "",
      "HTML example attachments:",
      ...(htmlExamplePaths.length > 0
        ? htmlExamplePaths.map((filePath, index) => `${index + 1}. ${filePath}`)
        : ["(none)"])
    ].join("\n");
    await fs.writeFile(manifestPath, manifestBody, "utf8");

    return {
      imagePaths,
      htmlExamplePaths,
      manifestPath
    };
  }

  private async downloadJiraAttachment(
    contentUrl: string,
    targetPath: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (await fileExists(targetPath)) {
      return;
    }

    const response = await axios.get<ArrayBuffer>(contentUrl, {
      responseType: "arraybuffer",
      ...(signal ? { signal } : {}),
      auth: {
        username: this.config.JIRA_EMAIL,
        password: this.config.JIRA_API_TOKEN
      },
      timeout: 30000
    });

    await fs.writeFile(targetPath, Buffer.from(new Uint8Array(response.data)));
  }
}

export function buildCodexPrompt(input: {
  ticket: JiraTicket;
  repoPath: string;
  mode: "context" | "implementation" | "review" | "repair";
  validation?: ValidationResult;
  ticketContextPath: string;
  visualReviewPlanPath: string;
  visualReviewReportPath: string;
  atlassianMcpEnabled: boolean;
  atlassianMcpAvailable: boolean;
  reviewFindingsPath?: string;
  jiraImagePaths: string[];
  jiraHtmlExamplePaths: string[];
  repoContextPaths: string[];
  inlineHtmlExamples: string[];
  jiraAssetManifestPath?: string;
}): string {
  const formattedComments = formatJiraCommentsForPrompt(
    input.ticket.comments,
    input.ticket.humanComments
  );
  const liveJiraInstructions =
    input.atlassianMcpEnabled && input.atlassianMcpAvailable
      ? [
          "Atlassian MCP is available in this Codex session.",
          `Before relying on the pre-fetched Jira snapshot below, use Atlassian MCP to fetch the live Jira issue by URL or key: ${input.ticket.url} (${input.ticket.key}).`,
          "Use the live Jira read to inspect the current description, full comment history, and attachment/link context, then reconcile any differences against the pre-fetched snapshot in this prompt.",
          "Treat the pre-fetched Jira data below as fallback context, not the sole source of truth."
        ]
      : input.atlassianMcpEnabled
        ? [
            "Atlassian MCP was requested for this Codex run, but it is not available in the current CLI environment.",
            "Rely on the pre-fetched Jira snapshot below as the source of truth for this run."
          ]
        : [];
  const validationSummary = input.validation
    ? [
        "",
        "Latest validation failures:",
        ...input.validation.steps.map((step) =>
          [
            `COMMAND: ${step.command}`,
            `SUCCESS: ${step.success}`,
            `EXIT CODE: ${step.exitCode ?? "unknown"}`,
            `STDOUT:\n${truncate(step.stdout, 4000) || "(empty)"}`,
            `STDERR:\n${truncate(step.stderr, 4000) || "(empty)"}`
          ].join("\n")
        )
      ].join("\n\n")
    : "";

  const modeInstructions =
    input.mode === "context"
      ? [
          "Before broader repository exploration, open every repo-local context file listed below and treat it as required ticket context.",
          "Your first task is to inspect the repository and create or refresh the ticket context markdown before any implementation work.",
          `Refresh this exact file: ${input.ticketContextPath}`,
          "The markdown must capture the full ticket context: summary, ticket URL, description, acceptance criteria, human comment chronology, repo-local context files referenced by the ticket, image and HTML example assets, files/components inspected, reusable components to reuse, smaller reusable components to create if needed, separation-of-concerns/readability notes, and a concrete implementation plan.",
          "If the ticket includes an HTML example inline or as a downloaded HTML file, search the repository for the matching surface or example and record whether it already exists.",
          `Also create or refresh this exact visual review plan JSON: ${input.visualReviewPlanPath}`,
          "The visual review plan must always be valid JSON. When automated browser comparison is practical, enable it and provide the HTML example target plus the implementation preview command, working directory, URL, route selector, and viewport needed for headless review. When it is not practical, still create the file with `enabled: false` and a short reason.",
          "Use this visual review plan shape:",
          "{",
          '  "enabled": true,',
          '  "reason": "short explanation",',
          '  "viewport": { "width": 1440, "height": 1024 },',
          '  "fullPage": true,',
          '  "example": { "type": "file", "path": ".jira-assets/TICKET/example.html", "readySelector": "body", "screenshotSelector": "body", "delayMs": 200 },',
          '  "implementation": { "type": "url", "url": "http://127.0.0.1:4173/route", "startCommand": "npm run dev -- --host 127.0.0.1 --port 4173", "workingDirectory": ".", "readySelector": "#root", "screenshotSelector": "#root", "delayMs": 400 },',
          '  "diff": { "maxDiffRatio": 0.03, "maxDiffPixels": 12000 }',
          "}",
          "In this mode, only update documentation under docs/. Do not implement product code yet.",
          "End with a short plain-text summary that mentions the ticket context markdown path you refreshed."
        ]
      : input.mode === "implementation"
        ? [
            "Before broader repository exploration, open every repo-local context file listed below and treat it as required context for this ticket.",
            "Read the ticket context markdown first and use it as your working memory before you implement anything.",
            `Ticket context markdown path: ${input.ticketContextPath}`,
            `Visual review plan path: ${input.visualReviewPlanPath}`,
            "Analyze the whole ticket, all human comments, and any local Jira assets before deciding what to edit.",
            "If the ticket includes an HTML example inline or as a downloaded HTML attachment, check whether that example already exists in the repository.",
            "When aligning UI to an HTML example, do not copy the example's exact HTML structure. Reuse existing component composition, update styles and UI behavior accordingly, and extract smaller reusable components when that improves reuse, readability, or separation of concerns.",
            "Prefer existing reusable components before creating new ones. If new pieces are needed, keep them small, composable, and aligned with best React practices.",
            "If a visual review plan JSON exists, keep it accurate whenever your implementation changes the local preview command, route, selector, or viewport assumptions used for browser comparison.",
            ...(input.reviewFindingsPath
              ? [
                  `Before editing, read and address the post-implementation review findings in: ${input.reviewFindingsPath}`,
                  "Treat every finding in that review document as required follow-up work unless you can clearly justify why it should not change the code."
                ]
              : [])
          ]
        : input.mode === "review"
          ? [
              "You are a fresh reviewer for the already-implemented ticket. Re-analyze the ticket, comments, context markdown, local Jira assets, and current repository changes from scratch.",
              `Read the ticket context markdown first: ${input.ticketContextPath}`,
              `If it exists, read the visual review report before judging the implementation: ${input.visualReviewReportPath}`,
              `Refresh this exact review file: ${buildImplementationReviewPath(input.ticket.key)}`,
              "In review mode, only update the review markdown under docs/. Do not implement product code.",
              "Review whether the current implementation fully addresses the ticket, comments, UI expectations, and any HTML example guidance.",
              "If the ticket includes an HTML example, confirm that the implementation matched the intent without copying the exact example HTML structure.",
              "Look specifically for missed requirements, weak reuse, poor separation of concerns, readability issues, and places where an existing component should have been reused.",
              "Use this exact review file structure:",
              "# Implementation Review",
              "",
              "Decision: approved | needs_follow_up",
              "Summary: one sentence",
              "",
              "Findings:",
              "- finding 1",
              "- finding 2",
              "",
              "Use `- None.` when there are no findings.",
              "Only include findings that are actionable and grounded in the ticket or current implementation."
            ]
          : [
              "Re-read the ticket context markdown before repairing validation failures.",
              `Ticket context markdown path: ${input.ticketContextPath}`,
              `If it exists, read the visual review report before repairing: ${input.visualReviewReportPath}`,
              "Keep the implementation aligned with the documented plan, reusable component strategy, and any HTML example constraints.",
              ...(input.reviewFindingsPath
                ? [
                    `Also read the post-implementation review findings in: ${input.reviewFindingsPath}`
                  ]
                : [])
            ];

  return [
    "You are Codex working inside a git worktree created for a single Jira ticket.",
    "Inspect the repository directly before editing anything.",
    ...liveJiraInstructions,
    "Before wider repo exploration, read any exact repo-local context files listed below.",
    "Use repository search, file reads, git diff, and targeted validation commands as needed.",
    "Make the smallest complete code change that fully addresses the ticket, acceptance criteria, and material human comment feedback.",
    "When a ticket asks to update styles or UI from an example, address the full described surface rather than a narrow cosmetic subset.",
    "Prefer fixing the actual user-facing surface mentioned in the ticket instead of nearby or similarly named screens.",
    "If there are multiple plausible surfaces, inspect all relevant callers/components before choosing.",
    ...modeInstructions,
    "Do not commit, push, or open pull requests.",
    "Leave all changes in the working tree.",
    "End with a short plain-text summary of what you changed and any remaining risk.",
    "",
    `Mode: ${input.mode}`,
    `Repository path: ${input.repoPath}`,
    `Ticket key: ${input.ticket.key}`,
    `Ticket URL: ${input.ticket.url}`,
    `Ticket summary: ${input.ticket.summary}`,
    `Ticket description:\n${input.ticket.description || "(empty)"}`,
    `Acceptance criteria:\n${input.ticket.acceptanceCriteria ?? "(not explicitly provided)"}`,
    `Visual review plan path:\n${input.visualReviewPlanPath}`,
    `Visual review report path:\n${input.visualReviewReportPath}`,
    `Jira asset manifest:\n${input.jiraAssetManifestPath ?? "(none)"}`,
    `Jira image attachments saved locally:\n${input.jiraImagePaths.join("\n") || "(none)"}`,
    `Jira HTML example attachments saved locally:\n${input.jiraHtmlExamplePaths.join("\n") || "(none)"}`,
    `Repository-local context files mentioned by the ticket/comments:\n${input.repoContextPaths.join("\n") || "(none detected)"}`,
    `Possible inline HTML examples from the ticket/comments:\n${input.inlineHtmlExamples.join("\n\n---\n\n") || "(none detected)"}`,
    `Human Jira comments with metadata:\n${formattedComments}`,
    `Post-implementation review findings path:\n${input.reviewFindingsPath ?? "(none)"}`,
    validationSummary,
    "",
    "If Jira screenshots, HTML example files, or repo-local context files are provided, inspect them before editing the UI they describe.",
    "Before you finish:",
    "1. Verify the ticketed surface was actually edited or intentionally justified.",
    "2. Run focused checks when feasible.",
    "3. Summarize the exact affected files and behavior."
  ].join("\n");
}

export function buildCodexExecArgs(input: {
  model: string;
  outputPath: string;
  prompt: string;
  profile?: string;
}): string[] {
  return [
    "exec",
    ...(input.profile ? ["--profile", input.profile] : []),
    "-a",
    "never",
    "-c",
    'model_reasoning_effort="xhigh"',
    "--sandbox",
    "workspace-write",
    "--output-last-message",
    input.outputPath,
    "--skip-git-repo-check",
    "--model",
    input.model,
    input.prompt
  ];
}

async function discoverRepoContextPaths(
  ticket: JiraTicket,
  repoPath: string,
  repoName?: string
): Promise<string[]> {
  const references = extractLikelyRepoFileReferences(collectTicketTextSources(ticket), repoName);
  const resolvedPaths: string[] = [];

  for (const reference of references) {
    const resolvedPath = path.resolve(repoPath, reference);
    const normalizedRepoPath = `${path.resolve(repoPath)}${path.sep}`;
    if (!resolvedPath.startsWith(normalizedRepoPath) && resolvedPath !== path.resolve(repoPath)) {
      continue;
    }

    if (!(await fileExists(resolvedPath))) {
      continue;
    }

    resolvedPaths.push(path.relative(repoPath, resolvedPath).split(path.sep).join(path.posix.sep));
  }

  return Array.from(new Set(resolvedPaths));
}

async function ensureGitExclude(repoPath: string, entry: string): Promise<void> {
  const gitDirResult = await execa("git", ["rev-parse", "--git-dir"], {
    cwd: repoPath,
    reject: false
  });
  const gitDir =
    gitDirResult.exitCode === 0 && gitDirResult.stdout.trim() ? gitDirResult.stdout.trim() : ".git";
  const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(repoPath, gitDir);
  const excludePath = path.join(resolvedGitDir, "info", "exclude");
  let current: string;

  try {
    current = await fs.readFile(excludePath, "utf8");
  } catch {
    current = "";
  }

  if (current.split("\n").includes(entry)) {
    return;
  }

  const next = current.trimEnd() ? `${current.trimEnd()}\n${entry}\n` : `${entry}\n`;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, next, "utf8");
}

function buildTicketContextPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.md`);
}

function buildVisualReviewPlanPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.visual-plan.json`);
}

function buildVisualReviewReportPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.visual-review.md`);
}

function buildImplementationReviewPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.review.md`);
}

function sanitizeFilename(filename: string, index: number): string {
  const ext = path.extname(filename).slice(0, 10) || ".img";
  const basename = path.basename(filename, path.extname(filename)) || `image-${index + 1}`;
  const safeBase =
    basename
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || `image-${index + 1}`;
  const hash = createHash("sha1").update(filename).digest("hex").slice(0, 8);
  return `${safeBase}-${hash}${ext}`;
}

async function readSummary(outputPath: string, stdout: string, stderr: string): Promise<string> {
  try {
    const content = (await fs.readFile(outputPath, "utf8")).trim();
    if (content) {
      return content;
    }
  } catch {
    // Fall back to process output below when the helper file is absent.
  }

  return truncate([stdout, stderr].filter(Boolean).join("\n\n").trim(), 2000);
}

async function listChangedFiles(repoPath: string): Promise<string[]> {
  const status = await execa("git", ["status", "--short", "--untracked-files=all"], {
    cwd: repoPath,
    reject: false
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

function extractInlineHtmlExamples(ticket: JiraTicket): string[] {
  const sources = [ticket.description, ...(ticket.humanComments ?? [])];
  const snippets: string[] = [];

  for (const source of sources) {
    for (const block of source.split(/\n{2,}/)) {
      const normalizedBlock = block.trim();
      if (!normalizedBlock || !/<\/?[a-z][^>]*>/i.test(normalizedBlock)) {
        continue;
      }

      snippets.push(truncate(normalizedBlock, 500));
      if (snippets.length >= 5) {
        return Array.from(new Set(snippets));
      }
    }
  }

  return Array.from(new Set(snippets));
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readImplementationReview(
  repoPath: string,
  reviewPath: string
): Promise<{
  decision: "approved" | "needs_follow_up";
  summary: string;
  findings: string[];
} | null> {
  const fullPath = path.join(repoPath, reviewPath);
  if (!(await fileExists(fullPath))) {
    return null;
  }

  const content = await fs.readFile(fullPath, "utf8");
  const decisionMatch = content.match(/^Decision:\s*(approved|needs_follow_up)\s*$/im);
  const summaryMatch = content.match(/^Summary:\s*(.+)\s*$/im);
  const findingsSectionMatch = content.match(/^Findings:\s*([\s\S]*)$/im);

  if (!decisionMatch || !summaryMatch || !findingsSectionMatch) {
    return null;
  }

  const decision = decisionMatch[1];
  const summary = summaryMatch[1];
  const findingsSection = findingsSectionMatch[1];
  if (!decision || !summary || !findingsSection) {
    return null;
  }

  const findings = findingsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== "none.");

  return {
    decision: decision as "approved" | "needs_follow_up",
    summary: summary.trim(),
    findings
  };
}
