import express from "express";

import { config } from "./config.js";
import { Worker } from "./worker.js";
import { Logger } from "./utils/logger.js";

const app = express();
const logger = new Logger("http");
const worker = new Worker(config);
let pollTimer: NodeJS.Timeout | undefined;

app.use(express.json());

app.get("/health", (_request, response) => {
  logger.info("Received health check");
  response.json({ ok: true });
});

app.post("/run-next", async (_request, response) => {
  logger.info("Received run-next request");
  if (worker.running) {
    logger.warn("Rejected run-next request because worker is already running");
    response.status(409).json({
      ok: false,
      message: "A worker run is already in progress."
    });
    return;
  }

  try {
    const result = await worker.runNext();
    logger.info("Completed run-next request", {
      status: result.status,
      ticketKey: result.ticketKey
    });
    response.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    logger.error("Unhandled error while running worker", error);
    response.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Unknown worker error"
    });
  }
});

app.listen(config.PORT, () => {
  logger.info(`Server listening on port ${config.PORT}`);
  if (config.POLL_ENABLED) {
    logger.info("Automatic Jira polling enabled", {
      intervalMs: config.POLL_INTERVAL_MS
    });

    pollTimer = setInterval(() => {
      void runPollCycle();
    }, config.POLL_INTERVAL_MS);

    void runPollCycle();
    return;
  }

  logger.info("Automatic Jira polling is disabled; use POST /run-next to trigger runs");
});

async function runPollCycle(): Promise<void> {
  if (worker.running) {
    logger.info("Skipping polling cycle because worker is already running");
    return;
  }

  logger.info("Starting scheduled polling cycle");

  try {
    const result = await worker.runNext();
    logger.info("Scheduled polling cycle completed", {
      status: result.status,
      ticketKey: result.ticketKey
    });
  } catch (error) {
    logger.error("Scheduled polling cycle failed", error);
  }
}

process.on("SIGINT", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  process.exit(0);
});
