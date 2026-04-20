import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { RunMonitor } from "../src/run-monitor.js";

describe("RunMonitor.appendStepOutput", () => {
  it("appends normalized lines to the selected step output", () => {
    const monitor = new RunMonitor();

    monitor.startRun();
    monitor.startStep("implement_changes", "Running implementation.");
    monitor.appendStepOutput("implement_changes", "Thinking about affected files");
    monitor.appendStepOutput("implement_changes", ["Reading src/ui.ts", "Planning patch"]);

    const step = monitor.getSnapshot().steps.find((entry) => entry.id === "implement_changes");
    assert.deepEqual(step?.output, [
      "Thinking about affected files",
      "Reading src/ui.ts",
      "Planning patch"
    ]);
  });

  it("deduplicates consecutive repeated lines", () => {
    const monitor = new RunMonitor();

    monitor.startRun();
    monitor.startStep("review_implementation", "Running review.");
    monitor.appendStepOutput("review_implementation", "Scanning repository");
    monitor.appendStepOutput("review_implementation", "Scanning repository");

    const step = monitor.getSnapshot().steps.find((entry) => entry.id === "review_implementation");
    assert.deepEqual(step?.output, ["Scanning repository"]);
  });
});
