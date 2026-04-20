import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { chromium } from "playwright";

import { renderAppHtml } from "../src/ui.ts";
import {
  WORKFLOW_STEP_DEFINITIONS,
  type WorkerRunSnapshot,
  type WorkflowStepState
} from "../src/types.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(projectRoot, "dist/assets");
const screenshotPath = path.join(projectRoot, "docs/screenshots/dashboard.png");
const port = Number(process.env.CAPTURE_PORT ?? 4717);

const mockSnapshot = buildMockSnapshot();

async function main(): Promise<void> {
  await mkdir(path.dirname(screenshotPath), { recursive: true });

  const app = express();
  app.use("/assets", express.static(assetsDir));
  app.get("/", (_request, response) => {
    response.type("html").send(renderAppHtml());
  });
  app.get("/api/run-state", (_request, response) => {
    response.json(mockSnapshot);
  });
  app.get("/api/run-events", (_request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.flushHeaders();
    response.write(`data: ${JSON.stringify(mockSnapshot)}\n\n`);
    _request.on("close", () => response.end());
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(port, () => resolve(instance));
  });

  try {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1520, height: 1080 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".pipeline-canvas, .ticket-list", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await browser.close();
    console.log(`Wrote screenshot: ${screenshotPath}`);
  } finally {
    server.close();
  }
}

function buildMockSnapshot(): WorkerRunSnapshot {
  const now = new Date("2026-04-19T18:12:00Z");
  const stepOverrides: Record<string, Partial<WorkflowStepState>> = {
    fetch_ticket: { status: "completed", detail: "Loaded 3 tickets from queue" },
    evaluate_guardrails: { status: "completed", detail: "All tickets passed guardrails" },
    comment_start: { status: "completed", detail: "Posted start comment to PROJ-101" },
    prepare_repository: { status: "completed", detail: "Worktree ready on ai/proj-101-refactor-auth" },
    document_context: { status: "completed", detail: "Updated docs/tickets/PROJ-101.md" },
    implement_changes: {
      status: "running",
      detail: "Codex implementation pass",
      currentCommand: "codex exec implement",
      output: ["Reading src/services/auth.ts", "Planning changes across 4 files"]
    },
    visual_review: { status: "idle" },
    review_implementation: { status: "idle" },
    validation: { status: "idle" },
    commit_push: { status: "idle" },
    create_pull_request: { status: "idle" },
    finalize_jira: { status: "idle" }
  };

  const steps: WorkflowStepState[] = WORKFLOW_STEP_DEFINITIONS.map((definition) => {
    const override = stepOverrides[definition.id] ?? {};
    return {
      id: definition.id,
      label: definition.label,
      status: override.status ?? "idle",
      detail: override.detail,
      currentCommand: override.currentCommand,
      output: override.output ?? [],
      startedAt: override.status && override.status !== "idle" ? now.toISOString() : undefined,
      finishedAt: override.status === "completed" ? now.toISOString() : undefined
    };
  });

  return {
    runId: 42,
    status: "running",
    stopRequested: false,
    startedAt: now.toISOString(),
    currentStepId: "implement_changes",
    currentTicketKey: "PROJ-101",
    tickets: [
      {
        key: "PROJ-101",
        summary: "Refactor auth middleware to use shared token helper",
        url: "https://example.invalid/browse/PROJ-101",
        status: "running",
        detail: "Implementation pass"
      },
      {
        key: "PROJ-102",
        summary: "Align user settings modal with new design tokens",
        url: "https://example.invalid/browse/PROJ-102",
        status: "queued"
      },
      {
        key: "PROJ-103",
        summary: "Add unit coverage for the export queue throttle",
        url: "https://example.invalid/browse/PROJ-103",
        status: "queued"
      }
    ],
    steps,
    logs: [
      { timestamp: now.toISOString(), message: "Worker run started", stepId: "fetch_ticket" },
      { timestamp: now.toISOString(), message: "3 tickets queued", stepId: "fetch_ticket" },
      { timestamp: now.toISOString(), message: "Guardrails accepted all 3 tickets", stepId: "evaluate_guardrails" },
      { timestamp: now.toISOString(), message: "Processing PROJ-101", stepId: "implement_changes" }
    ]
  };
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
