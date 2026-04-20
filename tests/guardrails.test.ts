import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { evaluateTicketGuardrails } from "../src/utils/guardrails.js";
import type { JiraTicket } from "../src/types.js";

const guardrailConfig = {
  hardBlockedKeywordPattern:
    /\b(api[ -]?keys?|secrets?|private keys?|token rotation|database migrations?|schema migrations?|data backfills?|infrastructure migrations?|terraform|kubernetes|helm|deploy(?:ment|ments)?|ci\/cd|github actions|billing|payment)\b/i,
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
    const result = evaluateTicketGuardrails(ticket({ description: strongDescription }), guardrailConfig);
    assert.equal(result, null);
  });

  it("flags tickets that mention hard-blocked keywords in the summary", () => {
    const result = evaluateTicketGuardrails(
      ticket({ summary: "Rotate API key for production", description: strongDescription }),
      guardrailConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("flags hard-blocked keywords that appear only in human comments", () => {
    const result = evaluateTicketGuardrails(
      ticket({
        description: strongDescription,
        humanComments: ["Reminder: this requires a database migration before shipping"]
      }),
      guardrailConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("is case-insensitive for hard-blocked keywords", () => {
    const result = evaluateTicketGuardrails(
      ticket({ summary: "Update TERRAFORM modules", description: strongDescription }),
      guardrailConfig
    );
    assert.match(result ?? "", /hard-blocked/i);
  });

  it("rejects tickets with weak requirements", () => {
    const result = evaluateTicketGuardrails(
      ticket({ description: "Fix this" }),
      guardrailConfig
    );
    assert.match(result ?? "", /weak or incomplete/i);
  });

  it("combines summary, description, acceptance criteria, and comments when evaluating strength", () => {
    const result = evaluateTicketGuardrails(
      ticket({
        summary: "Short title",
        description: "",
        acceptanceCriteria: strongDescription
      }),
      guardrailConfig
    );
    assert.equal(result, null);
  });

  it("does not match unrelated substrings (word boundary)", () => {
    const result = evaluateTicketGuardrails(
      ticket({ description: `${strongDescription}\n\nNote: see keymaster.ts for context.` }),
      guardrailConfig
    );
    assert.equal(result, null);
  });
});
