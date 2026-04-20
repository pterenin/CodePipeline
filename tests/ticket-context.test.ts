import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  extractLikelyRepoFileReferences,
  formatJiraCommentsForPrompt
} from "../src/utils/ticket-context.js";

describe("extractLikelyRepoFileReferences", () => {
  it("extracts repo-local file references from ticket text", () => {
    const result = extractLikelyRepoFileReferences(
      [
        "Use NeironHub/.html_examples/ProposalDetailsPage.html as the visual reference.",
        "Also inspect src/ui.ts before editing."
      ],
      "NeironHub"
    );

    assert.deepEqual(result, [".html_examples/ProposalDetailsPage.html", "src/ui.ts"]);
  });

  it("ignores URLs and deduplicates repeated references", () => {
    const result = extractLikelyRepoFileReferences(
      [
        "Ticket: https://example.invalid/browse/ABC-123",
        "Check `.html_examples/ProposalDetailsPage.html`.",
        "Check .html_examples/ProposalDetailsPage.html again."
      ],
      "NeironHub"
    );

    assert.deepEqual(result, [".html_examples/ProposalDetailsPage.html"]);
  });
});

describe("formatJiraCommentsForPrompt", () => {
  it("includes comment metadata when structured comments are available", () => {
    const result = formatJiraCommentsForPrompt([
      {
        id: "10001",
        authorName: "Ada Lovelace",
        createdAt: "2026-04-18T12:00:00.000+0000",
        updatedAt: "2026-04-18T14:30:00.000+0000",
        bodyText: "Match the Proposal Details layout and keep the existing component tree."
      }
    ]);

    assert.match(result, /Ada Lovelace/);
    assert.match(result, /2026-04-18T12:00:00.000\+0000/);
    assert.match(result, /2026-04-18T14:30:00.000\+0000/);
    assert.match(result, /keep the existing component tree/);
  });

  it("falls back to plain comment strings when structured comments are unavailable", () => {
    const result = formatJiraCommentsForPrompt(undefined, ["First comment", "Second comment"]);

    assert.match(result, /Comment 1/);
    assert.match(result, /First comment/);
    assert.match(result, /Comment 2/);
    assert.match(result, /Second comment/);
  });
});
