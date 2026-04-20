import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateTicketGuardrails } from "../src/utils/guardrails.ts";
import { slugify } from "../src/utils/text.ts";
import type { JiraTicket } from "../src/types.ts";

const DEFAULT_HARD_BLOCKED_KEYWORDS = [
  "api key",
  "secret",
  "private key",
  "token rotation",
  "database migration",
  "schema migration",
  "data backfill",
  "infrastructure migration",
  "terraform",
  "kubernetes",
  "helm"
];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(projectRoot, "fixtures/tickets");

async function main(): Promise<void> {
  const entries = await readdir(fixturesDir);
  const ticketFiles = entries.filter((entry) => entry.endsWith(".json")).sort();

  if (ticketFiles.length === 0) {
    console.error(`No ticket fixtures found under ${fixturesDir}`);
    process.exitCode = 1;
    return;
  }

  const guardrailConfig = {
    hardBlockedKeywords: DEFAULT_HARD_BLOCKED_KEYWORDS,
    scanHumanCommentsInGuardrails: false,
    weakRequirementThreshold: 20
  };

  console.log("CodePipeline demo run");
  console.log("=====================");
  console.log(
    "Evaluates guardrails and branch naming against local fixtures only. No external services are called."
  );
  console.log("");

  let passed = 0;
  let blocked = 0;

  for (const fileName of ticketFiles) {
    const ticket = await readTicket(path.join(fixturesDir, fileName));
    const guardrailResult = evaluateTicketGuardrails(ticket, guardrailConfig);
    const branchName = `ai/${ticket.key.toLowerCase()}-${slugify(ticket.summary)}`;

    console.log(`Ticket: ${ticket.key}`);
    console.log(`  Summary: ${ticket.summary}`);
    console.log(`  Would branch as: ${branchName}`);

    if (guardrailResult === null) {
      console.log("  Guardrails: accepted — would proceed to the implementation pass");
      passed += 1;
    } else {
      console.log(`  Guardrails: skipped — ${guardrailResult}`);
      blocked += 1;
    }
    console.log("");
  }

  console.log(`Summary: ${passed} accepted, ${blocked} skipped, ${ticketFiles.length} total`);
}

async function readTicket(ticketPath: string): Promise<JiraTicket> {
  const raw = await readFile(ticketPath, "utf8");
  const parsed = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.key !== "string" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.description !== "string" ||
    typeof parsed.url !== "string"
  ) {
    throw new Error(`Fixture ${ticketPath} is missing required JiraTicket fields.`);
  }

  return parsed as JiraTicket;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
