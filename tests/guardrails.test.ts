import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { evaluateTicketGuardrails } from "../src/utils/guardrails.js";
import type { JiraTicket } from "../src/types.js";

const defaultConfig = {
  hardBlockedKeywords: [
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
  ],
  scanHumanCommentsInGuardrails: false,
  weakRequirementThreshold: 20
};

function ticket(overrides: Partial<JiraTicket> = {}): JiraTicket {
  return {
    key: "TEST-1",
    summary: "Ticket summary",
    description: "",
    url: "https://example.invalid/browse/TEST-1",
    ...overrides
  };
}

const strongDescription = [
  "Goal: rename `getCwd` to `getCurrentWorkingDirectory` across the service.",
  "",
  "Acceptance criteria:",
  "- Update every call site in `src/utils/path.ts` and downstream consumers",
  "- Add a unit test that covers the renamed helper",
  "- Definition of done includes a passing typecheck and build"
].join("\n");

describe("evaluateTicketGuardrails", () => {
  it("returns null for tickets with strong requirements and no hard-blocked keywords", () => {
    const result = evaluateTicketGuardrails(
      ticket({ description: strongDescription }),
      defaultConfig
    );
    assert.equal(result, null);
  });

  it("flags tickets that mention hard-blocked keywords in the summary", () => {
    const result = evaluateTicketGuardrails(
      ticket({ summary: "Rotate API key for production", description: strongDescription }),
      defaultConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("tolerates the plural form of a configured keyword", () => {
    const result = evaluateTicketGuardrails(
      ticket({ description: `${strongDescription}\n\nPerform database migrations next sprint.` }),
      defaultConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("is case-insensitive for hard-blocked keywords", () => {
    const result = evaluateTicketGuardrails(
      ticket({ summary: "Update TERRAFORM modules", description: strongDescription }),
      defaultConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("ignores human comments by default", () => {
    const result = evaluateTicketGuardrails(
      ticket({
        description: strongDescription,
        humanComments: ["Reminder: this requires a database migration before shipping"]
      }),
      defaultConfig
    );
    assert.equal(result, null);
  });

  it("scans human comments when scanHumanCommentsInGuardrails is true", () => {
    const result = evaluateTicketGuardrails(
      ticket({
        description: strongDescription,
        humanComments: ["Reminder: this requires a database migration before shipping"]
      }),
      { ...defaultConfig, scanHumanCommentsInGuardrails: true }
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("rejects tickets with weak requirements", () => {
    const result = evaluateTicketGuardrails(ticket({ description: "Fix this" }), defaultConfig);
    assert.match(result ?? "", /weak or incomplete/i);
  });

  it("combines summary, description, and acceptance criteria when evaluating strength", () => {
    const result = evaluateTicketGuardrails(
      ticket({
        summary: "Short title",
        description: "",
        acceptanceCriteria: strongDescription
      }),
      defaultConfig
    );
    assert.equal(result, null);
  });

  it("does not match unrelated substrings (word boundary)", () => {
    const result = evaluateTicketGuardrails(
      ticket({ description: `${strongDescription}\n\nNote: see keymaster.ts for context.` }),
      defaultConfig
    );
    assert.equal(result, null);
  });

  it("disables keyword hard-blocks when the keyword list is empty", () => {
    const result = evaluateTicketGuardrails(
      ticket({ summary: "Rotate API key immediately", description: strongDescription }),
      { ...defaultConfig, hardBlockedKeywords: [] }
    );
    assert.equal(result, null);
  });
});
