import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createProcessOutputBuffer } from "../src/utils/process-output.js";

describe("createProcessOutputBuffer", () => {
  it("emits complete lines across chunk boundaries and flushes the remainder", () => {
    const lines: string[] = [];
    const buffer = createProcessOutputBuffer((line) => {
      lines.push(line);
    });

    buffer.push("Thinking");
    buffer.push(" about the ticket\nReading src/ui.ts\n");
    buffer.push("Final partial line");
    buffer.flush();

    assert.deepEqual(lines, [
      "Thinking about the ticket",
      "Reading src/ui.ts",
      "Final partial line"
    ]);
  });

  it("strips ANSI control codes and ignores empty lines", () => {
    const lines: string[] = [];
    const buffer = createProcessOutputBuffer((line) => {
      lines.push(line);
    });

    buffer.push("\u001b[32mCompiled successfully\u001b[39m\r\n\r\n");
    buffer.flush();

    assert.deepEqual(lines, ["Compiled successfully"]);
  });
});
