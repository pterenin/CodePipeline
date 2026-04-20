import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { config } from "./config.js";
import { RunMonitor } from "./run-monitor.js";
import { renderAppHtml } from "./ui.js";
import { Worker } from "./worker.js";
import { Logger } from "./utils/logger.js";

const app = express();
const logger = new Logger("http");
const worker = new Worker(config);
const monitor = new RunMonitor();
const assetDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/assets",
);

app.use(express.json());
app.use("/assets", express.static(assetDirectory));

app.get("/", (_request, response) => {
  response.type("html").send(renderAppHtml());
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/run-state", (_request, response) => {
  response.json(monitor.getSnapshot());
});

app.get("/api/run-events", (_request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const unsubscribe = monitor.subscribe((snapshot) => {
    response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  });

  _request.on("close", () => {
    unsubscribe();
    response.end();
  });
});

app.post("/api/run", (_request, response) => {
  logger.info("Received UI run request");
  if (worker.running) {
    logger.warn("Rejected UI run request because worker is already running");
    response.status(409).json({
      ok: false,
      message: "A worker run is already in progress.",
    });
    return;
  }

  const dryRun = readDryRunFlag(_request);
  void runTriggeredExecution("ui", { ...(dryRun !== undefined ? { dryRun } : {}) });
  response.status(202).json({
    ok: true,
    message:
      dryRun === true
        ? "Dry run started."
        : config.DRY_RUN_BY_DEFAULT
          ? "Worker run started using default dry-run mode."
          : "Worker run started.",
  });
});

app.post("/api/run/dry-run", (_request, response) => {
  logger.info("Received UI dry-run request");
  if (worker.running) {
    logger.warn("Rejected UI dry-run request because worker is already running");
    response.status(409).json({
      ok: false,
      message: "A worker run is already in progress.",
    });
    return;
  }

  void runTriggeredExecution("ui-dry-run", { dryRun: true });
  response.status(202).json({
    ok: true,
    message: "Dry run started.",
  });
});

app.post("/api/run/stop", (_request, response) => {
  logger.info("Received UI stop request");
  if (!worker.running) {
    response.status(409).json({
      ok: false,
      message: "No worker run is currently in progress.",
    });
    return;
  }

  worker.requestStop(monitor);
  response.status(202).json({
    ok: true,
    message: "Stop request accepted.",
  });
});

app.post("/run-next", async (_request, response) => {
  logger.info("Received run-next request");
  if (worker.running) {
    logger.warn("Rejected run-next request because worker is already running");
    response.status(409).json({
      ok: false,
      message: "A worker run is already in progress.",
    });
    return;
  }

  try {
    const dryRun = readDryRunFlag(_request);
    const result = await worker.runNext(monitor, { ...(dryRun !== undefined ? { dryRun } : {}) });
    logger.info("Completed run-next request", {
      status: result.status,
      ticketKey: result.ticketKey,
    });
    response.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    logger.error("Unhandled error while running worker", error);
    response.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Unknown worker error",
    });
  }
});

app.listen(config.PORT, () => {
  logger.info(`Server listening on port ${config.PORT}`);
  logger.info(
    "Worker is trigger-only; use the UI or POST /run-next to start a run",
  );
});

async function runTriggeredExecution(
  source: string,
  options?: {
    dryRun?: boolean;
  }
): Promise<void> {
  logger.info("Starting triggered execution", {
    source,
    dryRun: options?.dryRun ?? false
  });

  try {
    const result = await worker.runNext(monitor, options);
    logger.info("Triggered execution completed", {
      source,
      status: result.status,
      ticketKey: result.ticketKey,
    });
  } catch (error) {
    logger.error("Triggered execution failed", error);
  }
}

process.on("SIGINT", () => {
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});

function readDryRunFlag(request: {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): boolean | undefined {
  const bodyValue = request.body?.dryRun;
  if (typeof bodyValue === "boolean") {
    return bodyValue;
  }

  if (typeof bodyValue === "string") {
    return parseBooleanLike(bodyValue);
  }

  const queryValue = request.query?.dryRun;
  if (typeof queryValue === "string") {
    return parseBooleanLike(queryValue);
  }

  return undefined;
}

function parseBooleanLike(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
