const ANSI_ESCAPE_PATTERN =
  // Matches common ANSI escape/control sequences emitted by CLIs.
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function createProcessOutputBuffer(
  onLine: (line: string) => void
): {
  push: (chunk: string | Buffer) => void;
  flush: () => void;
} {
  let pending = "";

  function emitNormalizedLines(text: string): void {
    const normalized = stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const segments = normalized.split("\n");
    pending += segments.shift() ?? "";

    for (const segment of segments) {
      emitLine(pending);
      pending = segment;
    }
  }

  function emitLine(value: string): void {
    const line = value.trim();
    if (!line) {
      return;
    }

    onLine(line);
  }

  return {
    push(chunk: string | Buffer) {
      emitNormalizedLines(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    },
    flush() {
      emitLine(pending);
      pending = "";
    }
  };
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "").replace(/\u0007/g, "");
}
