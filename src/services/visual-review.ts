import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { execa } from "execa";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { JiraTicket, VisualReviewResult } from "../types.js";
import { Logger } from "../utils/logger.js";
import { createProcessOutputBuffer } from "../utils/process-output.js";

const visualReviewTargetSchema = z
  .object({
    type: z.enum(["file", "url"]),
    path: z.string().trim().optional(),
    url: z.string().trim().optional(),
    readySelector: z.string().trim().optional(),
    screenshotSelector: z.string().trim().optional(),
    delayMs: z.coerce.number().int().nonnegative().optional(),
    authenticated: z.boolean().default(false)
  })
  .superRefine((value, context) => {
    if (value.type === "file" && !value.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "Set path when target type is file."
      });
    }

    if (value.type === "url" && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Set url when target type is url."
      });
    }
  });

const visualReviewPlanSchema = z
  .object({
    enabled: z.boolean().default(false),
    reason: z.string().trim().optional(),
    viewport: z
      .object({
        width: z.coerce.number().int().positive().max(4000).default(1440),
        height: z.coerce.number().int().positive().max(4000).default(1024)
      })
      .default({
        width: 1440,
        height: 1024
      }),
    fullPage: z.boolean().default(true),
    example: visualReviewTargetSchema.optional(),
    implementation: visualReviewTargetSchema
      .extend({
        startCommand: z.string().trim().optional(),
        workingDirectory: z.string().trim().optional(),
        startupTimeoutMs: z.coerce.number().int().positive().optional()
      })
      .optional(),
    diff: z
      .object({
        maxDiffRatio: z.coerce.number().min(0).max(1).default(0.03),
        maxDiffPixels: z.coerce.number().int().positive().optional()
      })
      .default({
        maxDiffRatio: 0.03
      })
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.example) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["example"],
        message: "Set example when visual review is enabled."
      });
    }

    if (value.enabled && !value.implementation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["implementation"],
        message: "Set implementation when visual review is enabled."
      });
    }
  });

type VisualReviewPlan = z.infer<typeof visualReviewPlanSchema>;
type VisualReviewTarget = z.infer<typeof visualReviewTargetSchema>;
type PreviewProcess = {
  exitCode: number | null | undefined;
  kill: (signal?: string) => boolean;
  catch: (onRejected?: (error: unknown) => unknown) => Promise<unknown>;
};

export class VisualReviewService {
  private readonly logger = new Logger("visual-review");

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "VISUAL_REVIEW_ENABLED"
      | "VISUAL_REVIEW_TIMEOUT_MS"
      | "VISUAL_REVIEW_STARTUP_TIMEOUT_MS"
      | "VISUAL_REVIEW_STORAGE_STATE"
    >
  ) {}

  async run(
    ticket: JiraTicket,
    repoPath: string,
    hooks?: {
      signal?: AbortSignal;
      onProgress?: (message: string) => void;
      onOutput?: (message: string) => void;
    }
  ): Promise<VisualReviewResult> {
    const planPath = buildVisualReviewPlanPath(ticket.key);
    const reportPath = buildVisualReviewReportPath(ticket.key);
    const artifactDir = path.join(repoPath, ".visual-review", ticket.key);
    const reportFullPath = path.join(repoPath, reportPath);

    await fs.mkdir(path.dirname(reportFullPath), { recursive: true });
    await fs.mkdir(artifactDir, { recursive: true });
    await ensureGitExclude(repoPath, ".visual-review/");

    if (!this.config.VISUAL_REVIEW_ENABLED) {
      const summary = "Visual review is disabled by configuration.";
      await this.writeReport(reportFullPath, {
        decision: "skipped",
        summary,
        findings: [],
        planPath,
        artifactPaths: []
      });
      return {
        decision: "skipped",
        summary,
        findings: [],
        reportPath,
        artifactPaths: []
      };
    }

    const plan = await this.loadPlan(repoPath, planPath);
    if (!plan) {
      const summary =
        "No visual review plan was created for this ticket, so browser comparison was skipped.";
      await this.writeReport(reportFullPath, {
        decision: "skipped",
        summary,
        findings: [],
        planPath,
        artifactPaths: []
      });
      return {
        decision: "skipped",
        summary,
        findings: [],
        reportPath,
        artifactPaths: []
      };
    }

    if (!plan.enabled) {
      const summary =
        plan.reason || "Visual review plan exists but explicitly disables automated comparison.";
      await this.writeReport(reportFullPath, {
        decision: "skipped",
        summary,
        findings: [],
        planPath,
        artifactPaths: []
      });
      return {
        decision: "skipped",
        summary,
        findings: [],
        reportPath,
        artifactPaths: []
      };
    }

    let previewProcess: PreviewProcess | undefined;
    try {
      hooks?.onProgress?.("Starting isolated headless browser review.");
      const exampleTarget = plan.example;
      const implementationTarget = plan.implementation;
      if (!exampleTarget || !implementationTarget) {
        throw new Error(
          "Visual review plan is enabled but example or implementation target is missing."
        );
      }

      if (implementationTarget.startCommand) {
        hooks?.onProgress?.("Starting implementation preview in its own process.");
        previewProcess = this.startPreviewProcess(plan, repoPath, hooks?.signal, hooks?.onOutput);
      }

      const implementationUrl = resolveTargetUrl(implementationTarget, repoPath);
      await this.waitForPreviewReady(
        implementationUrl,
        previewProcess,
        implementationTarget.startupTimeoutMs ?? this.config.VISUAL_REVIEW_STARTUP_TIMEOUT_MS,
        hooks?.signal
      );

      const browser = await chromium.launch({ headless: true });
      try {
        const exampleScreenshotPath = path.join(artifactDir, "example.png");
        const implementationScreenshotPath = path.join(artifactDir, "implementation.png");
        const diffScreenshotPath = path.join(artifactDir, "diff.png");

        hooks?.onProgress?.("Capturing HTML example screenshot in an isolated browser context.");
        await this.captureTargetScreenshot({
          browser,
          repoPath,
          target: exampleTarget,
          outputPath: exampleScreenshotPath,
          viewport: plan.viewport,
          fullPage: plan.fullPage,
          ...(hooks?.signal ? { signal: hooks.signal } : {})
        });

        hooks?.onProgress?.("Capturing implementation screenshot in an isolated browser context.");
        await this.captureTargetScreenshot({
          browser,
          repoPath,
          target: implementationTarget,
          outputPath: implementationScreenshotPath,
          viewport: plan.viewport,
          fullPage: plan.fullPage,
          ...(hooks?.signal ? { signal: hooks.signal } : {})
        });

        hooks?.onProgress?.("Comparing rendered screenshots.");
        const diff = await compareScreenshots(
          exampleScreenshotPath,
          implementationScreenshotPath,
          diffScreenshotPath
        );

        const findings: string[] = [];
        if (diff.dimensionMismatch) {
          findings.push(
            `Screenshot dimensions differ: example ${diff.exampleSize.width}x${diff.exampleSize.height}, implementation ${diff.implementationSize.width}x${diff.implementationSize.height}.`
          );
        }
        if (diff.diffRatio > plan.diff.maxDiffRatio) {
          findings.push(
            `Visual difference ratio ${formatRatio(diff.diffRatio)} exceeded the allowed threshold ${formatRatio(plan.diff.maxDiffRatio)}.`
          );
        }
        if (plan.diff.maxDiffPixels && diff.diffPixels > plan.diff.maxDiffPixels) {
          findings.push(
            `Visual diff pixel count ${diff.diffPixels} exceeded the allowed threshold ${plan.diff.maxDiffPixels}.`
          );
        }

        const decision = findings.length > 0 ? "needs_follow_up" : "approved";
        const summary =
          decision === "approved"
            ? `Visual review passed with diff ratio ${formatRatio(diff.diffRatio)}.`
            : `Visual review found ${findings.length} issue${findings.length === 1 ? "" : "s"} with diff ratio ${formatRatio(diff.diffRatio)}.`;
        const artifactPaths = [
          relativeToRepo(repoPath, exampleScreenshotPath),
          relativeToRepo(repoPath, implementationScreenshotPath),
          relativeToRepo(repoPath, diffScreenshotPath)
        ];

        await this.writeReport(reportFullPath, {
          decision,
          summary,
          findings,
          planPath,
          artifactPaths,
          metrics: diff
        });

        return {
          decision,
          summary,
          findings,
          reportPath,
          artifactPaths
        };
      } finally {
        await browser.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Visual review failed", {
        ticketKey: ticket.key,
        message
      });
      await this.writeReport(reportFullPath, {
        decision: "needs_human_review",
        summary: "Visual review could not run successfully.",
        findings: [],
        planPath,
        artifactPaths: [],
        failureReason: message
      });
      return {
        decision: "needs_human_review",
        summary: "Visual review could not run successfully.",
        findings: [],
        reportPath,
        artifactPaths: [],
        reason: message
      };
    } finally {
      if (previewProcess && previewProcess.exitCode === null) {
        previewProcess.kill("SIGTERM");
        await previewProcess.catch(() => undefined);
      }
    }
  }

  private async resolveStorageStatePath(repoPath: string): Promise<string | undefined> {
    const configured = this.config.VISUAL_REVIEW_STORAGE_STATE?.trim();
    if (!configured) {
      throw new Error(
        "Visual review target is marked authenticated but VISUAL_REVIEW_STORAGE_STATE is not set. Run `npm run visual:login` first."
      );
    }

    const resolved = path.isAbsolute(configured) ? configured : path.resolve(repoPath, configured);
    if (!(await fileExists(resolved))) {
      throw new Error(
        `Visual review storage state file not found at ${resolved}. Run \`npm run visual:login\` to create it.`
      );
    }

    return resolved;
  }

  private async loadPlan(repoPath: string, planPath: string): Promise<VisualReviewPlan | null> {
    const fullPath = path.join(repoPath, planPath);
    if (!(await fileExists(fullPath))) {
      return null;
    }

    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = visualReviewPlanSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `Visual review plan is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`
      );
    }

    return parsed.data;
  }

  private startPreviewProcess(
    plan: VisualReviewPlan,
    repoPath: string,
    signal?: AbortSignal,
    onOutput?: (message: string) => void
  ): PreviewProcess {
    const workingDirectory = plan.implementation?.workingDirectory
      ? path.resolve(repoPath, plan.implementation.workingDirectory)
      : repoPath;
    const child = execa(plan.implementation?.startCommand ?? "", {
      cwd: workingDirectory,
      shell: true,
      reject: false,
      stdout: "ignore",
      stderr: "pipe",
      ...(signal ? { cancelSignal: signal } : {}),
      env: {
        ...process.env,
        CI: "1"
      }
    });
    const stderrBuffer = createProcessOutputBuffer((line) => {
      onOutput?.(`preview: ${line}`);
    });

    child.stderr?.on("data", (chunk) => {
      stderrBuffer.push(chunk);
    });
    child.finally(() => {
      stderrBuffer.flush();
    });

    return child as PreviewProcess;
  }

  private async waitForPreviewReady(
    implementationUrl: string,
    previewProcess: PreviewProcess | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!implementationUrl.startsWith("http://") && !implementationUrl.startsWith("https://")) {
      return;
    }

    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Visual review was aborted.");
      }

      if (previewProcess && previewProcess.exitCode !== null && previewProcess.exitCode !== 0) {
        throw new Error(`Preview command exited early with code ${previewProcess.exitCode}.`);
      }

      try {
        const response = await fetch(implementationUrl, {
          method: "GET",
          ...(signal ? { signal } : {})
        });
        if (response.status < 500) {
          return;
        }
        lastError = `Preview URL returned ${response.status}.`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await delay(1000);
    }

    throw new Error(`Timed out waiting for preview URL ${implementationUrl}. ${lastError}`.trim());
  }

  private async captureTargetScreenshot(input: {
    browser: Awaited<ReturnType<typeof chromium.launch>>;
    repoPath: string;
    target: VisualReviewTarget;
    outputPath: string;
    viewport: { width: number; height: number };
    fullPage: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const storageStatePath = input.target.authenticated
      ? await this.resolveStorageStatePath(input.repoPath)
      : undefined;
    const context = await input.browser.newContext({
      viewport: input.viewport,
      ...(storageStatePath ? { storageState: storageStatePath } : {})
    });

    try {
      const page = await context.newPage();
      const url = resolveTargetUrl(input.target, input.repoPath);
      await page.goto(url, {
        waitUntil: "load",
        timeout: this.config.VISUAL_REVIEW_TIMEOUT_MS
      });

      if (input.target.readySelector) {
        await page.locator(input.target.readySelector).waitFor({
          state: "visible",
          timeout: this.config.VISUAL_REVIEW_TIMEOUT_MS
        });
      }

      if (input.target.delayMs) {
        await delay(input.target.delayMs);
      }

      if (input.signal?.aborted) {
        throw input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error("Visual review was aborted.");
      }

      if (input.target.screenshotSelector) {
        await page.locator(input.target.screenshotSelector).screenshot({
          path: input.outputPath
        });
        return;
      }

      await page.screenshot({
        path: input.outputPath,
        fullPage: input.fullPage
      });
    } finally {
      await context.close();
    }
  }

  private async writeReport(
    reportFullPath: string,
    input: {
      decision: VisualReviewResult["decision"];
      summary: string;
      findings: string[];
      planPath: string;
      artifactPaths: string[];
      metrics?: {
        diffPixels: number;
        diffRatio: number;
        exampleSize: { width: number; height: number };
        implementationSize: { width: number; height: number };
        dimensionMismatch: boolean;
      };
      failureReason?: string;
    }
  ): Promise<void> {
    const report = [
      "# Visual Review",
      "",
      `Decision: ${input.decision}`,
      `Summary: ${input.summary}`,
      `Plan: ${input.planPath}`,
      "",
      "Findings:",
      ...(input.findings.length > 0
        ? input.findings.map((finding) => `- ${finding}`)
        : ["- None."]),
      "",
      "Artifacts:",
      ...(input.artifactPaths.length > 0
        ? input.artifactPaths.map((artifactPath) => `- ${artifactPath}`)
        : ["- None."]),
      "",
      "Metrics:",
      ...(input.metrics
        ? [
            `- Diff pixels: ${input.metrics.diffPixels}`,
            `- Diff ratio: ${formatRatio(input.metrics.diffRatio)}`,
            `- Example size: ${input.metrics.exampleSize.width}x${input.metrics.exampleSize.height}`,
            `- Implementation size: ${input.metrics.implementationSize.width}x${input.metrics.implementationSize.height}`,
            `- Dimension mismatch: ${input.metrics.dimensionMismatch ? "yes" : "no"}`
          ]
        : ["- None."]),
      ...(input.failureReason ? ["", "Failure:", `- ${input.failureReason}`] : []),
      ""
    ].join("\n");

    await fs.writeFile(reportFullPath, report, "utf8");
  }
}

function buildVisualReviewPlanPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.visual-plan.json`);
}

function buildVisualReviewReportPath(ticketKey: string): string {
  return path.posix.join("docs", "tickets", `${ticketKey}.visual-review.md`);
}

function resolveTargetUrl(target: VisualReviewTarget, repoPath: string): string {
  if (target.type === "file") {
    const fullPath = path.isAbsolute(target.path ?? "")
      ? (target.path ?? "")
      : path.join(repoPath, target.path ?? "");
    return pathToFileURL(fullPath).href;
  }

  return target.url ?? "";
}

async function compareScreenshots(
  examplePath: string,
  implementationPath: string,
  diffPath: string
): Promise<{
  diffPixels: number;
  diffRatio: number;
  exampleSize: { width: number; height: number };
  implementationSize: { width: number; height: number };
  dimensionMismatch: boolean;
}> {
  const example = PNG.sync.read(await fs.readFile(examplePath));
  const implementation = PNG.sync.read(await fs.readFile(implementationPath));
  const width = Math.max(example.width, implementation.width);
  const height = Math.max(example.height, implementation.height);
  const normalizedExample = normalizePng(example, width, height);
  const normalizedImplementation = normalizePng(implementation, width, height);
  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(
    normalizedExample.data,
    normalizedImplementation.data,
    diff.data,
    width,
    height,
    {
      threshold: 0.1
    }
  );

  await fs.writeFile(diffPath, PNG.sync.write(diff));

  return {
    diffPixels,
    diffRatio: diffPixels / Math.max(1, width * height),
    exampleSize: {
      width: example.width,
      height: example.height
    },
    implementationSize: {
      width: implementation.width,
      height: implementation.height
    },
    dimensionMismatch:
      example.width !== implementation.width || example.height !== implementation.height
  };
}

function normalizePng(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) {
    return source;
  }

  const normalized = new PNG({ width, height });
  PNG.bitblt(source, normalized, 0, 0, source.width, source.height, 0, 0);
  return normalized;
}

async function ensureGitExclude(repoPath: string, entry: string): Promise<void> {
  const gitDirResult = await execa("git", ["rev-parse", "--git-dir"], {
    cwd: repoPath,
    reject: false
  });
  const gitDir =
    gitDirResult.exitCode === 0 && gitDirResult.stdout.trim() ? gitDirResult.stdout.trim() : ".git";
  const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(repoPath, gitDir);
  const gitInfoExclude = path.join(resolvedGitDir, "info", "exclude");
  let current: string;

  try {
    current = await fs.readFile(gitInfoExclude, "utf8");
  } catch {
    current = "";
  }

  if (current.split("\n").includes(entry)) {
    return;
  }

  const next = current.trimEnd() ? `${current.trimEnd()}\n${entry}\n` : `${entry}\n`;
  await fs.mkdir(path.dirname(gitInfoExclude), { recursive: true });
  await fs.writeFile(gitInfoExclude, next, "utf8");
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function relativeToRepo(repoPath: string, fullPath: string): string {
  return path.relative(repoPath, fullPath).replace(/\\/g, "/");
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
