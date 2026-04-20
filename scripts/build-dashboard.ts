import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { getDashboardClientSource } from "../src/ui.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(projectRoot, "dist/assets/dashboard.js");

async function main(): Promise<void> {
  await mkdir(path.dirname(outputFile), { recursive: true });

  await build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    format: "esm" as const,
    minify: true,
    outfile: outputFile,
    platform: "browser" as const,
    stdin: {
      contents: rewriteDashboardSource(getDashboardClientSource()),
      loader: "jsx" as const,
      resolveDir: projectRoot,
      sourcefile: "dashboard-inline.jsx",
    },
    target: ["es2020"],
  });

  console.log(`Built dashboard asset: ${outputFile}`);
}

function rewriteDashboardSource(source: string): string {
  let rewrittenSource = replaceOnce(
    source,
    /^const \{ useEffect, useMemo, useState \} = React;\s*/u,
    'import React, { useEffect, useMemo, useState } from "react";\nimport { createRoot } from "react-dom/client";\n\n',
    "React imports",
  );

  rewrittenSource = replaceOnce(
    rewrittenSource,
    /const root = ReactDOM\.createRoot\(document\.getElementById\("app"\)\);/u,
    [
      'const rootElement = document.getElementById("app");',
      'if (!rootElement) {',
      '  throw new Error("Dashboard mount element not found.");',
      "}",
      "const root = createRoot(rootElement);",
    ].join("\n"),
    "dashboard root creation",
  );

  return rewrittenSource;
}

function replaceOnce(
  input: string,
  pattern: RegExp,
  replacement: string,
  label: string,
): string {
  const output = input.replace(pattern, replacement);
  if (output === input) {
    throw new Error(`Could not rewrite ${label} while bundling dashboard assets.`);
  }

  return output;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
