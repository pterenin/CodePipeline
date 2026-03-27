import express from "express";

import { config } from "./config.js";
import { Worker } from "./worker.js";
import { Logger } from "./utils/logger.js";

const app = express();
const logger = new Logger("http");
const worker = new Worker(config);

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/run-next", async (_request, response) => {
  if (worker.running) {
    response.status(409).json({
      ok: false,
      message: "A worker run is already in progress."
    });
    return;
  }

  try {
    const result = await worker.runNext();
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
});
