import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { chromium } from "playwright";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const storageStatePath = resolveStorageStatePath();
const startUrl = process.env.VISUAL_REVIEW_LOGIN_URL?.trim();

async function main(): Promise<void> {
  if (!startUrl) {
    throw new Error(
      "Set VISUAL_REVIEW_LOGIN_URL (the login page URL) before running `npm run visual:login`."
    );
  }

  await mkdir(path.dirname(storageStatePath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });

  console.log("\nA browser window is open. Sign in and navigate through any MFA steps.");
  console.log(`Storage state will be written to: ${storageStatePath}`);
  console.log("Press Enter in this terminal once you are fully logged in.\n");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    await rl.question("Press Enter after login is complete... ");
  } finally {
    rl.close();
  }

  await context.storageState({ path: storageStatePath });
  await browser.close();

  console.log(`\nSaved storage state to ${storageStatePath}`);
  console.log("Point VISUAL_REVIEW_STORAGE_STATE at this file so the pipeline reuses the session.");
}

function resolveStorageStatePath(): string {
  const configured = process.env.VISUAL_REVIEW_STORAGE_STATE?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured);
  }
  return path.resolve(projectRoot, ".visual-review/storage-state.json");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
