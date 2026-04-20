import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  extractAcceptanceCriteria,
  hasStrongRequirements,
  normalizeWhitespace,
  slugify,
  truncate
} from "../src/utils/text.js";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumerics with dashes", () => {
    assert.equal(slugify("Add OAuth login!"), "add-oauth-login");
  });

  it("trims leading and trailing dashes", () => {
    assert.equal(slugify("  ---Hello World---  "), "hello-world");
  });

  it("truncates to 40 characters", () => {
    const result = slugify("a".repeat(100));
    assert.equal(result.length, 40);
  });

  it("falls back to 'ticket' when no usable characters remain", () => {
    assert.equal(slugify("***"), "ticket");
    assert.equal(slugify(""), "ticket");
  });
});

describe("truncate", () => {
  it("returns input unchanged when under the limit", () => {
    assert.equal(truncate("short", 10), "short");
  });

  it("returns input unchanged when exactly at the limit", () => {
    assert.equal(truncate("exact", 5), "exact");
  });

  it("adds an ellipsis when the input is longer than the limit", () => {
    assert.equal(truncate("abcdefghij", 6), "abc...");
  });

  it("never returns a string longer than the limit", () => {
    const result = truncate("abcdefghijklmnop", 8);
    assert.ok(result.length <= 8);
  });
});

describe("normalizeWhitespace", () => {
  it("converts CRLF to LF and trims edges", () => {
    assert.equal(normalizeWhitespace("  line one\r\nline two\r\n  "), "line one\nline two");
  });

  it("leaves interior whitespace alone", () => {
    assert.equal(normalizeWhitespace("a\n  b\n c"), "a\n  b\n c");
  });
});

describe("hasStrongRequirements", () => {
  const threshold = 20;

  it("rejects text below the length threshold", () => {
    assert.equal(hasStrongRequirements("too short", threshold), false);
  });

  it("rejects medium-length single-sentence prose without structure signals", () => {
    const text = "This ticket has no structure and almost no actionable signals at all";
    assert.equal(hasStrongRequirements(text, threshold), false);
  });

  it("accepts text with explicit acceptance criteria and bullets", () => {
    const text = [
      "Goal: allow admins to rotate user API keys from the settings page.",
      "",
      "Acceptance criteria:",
      "- Rotating the key invalidates the previous one",
      "- Users see a warning before rotation",
      "- The new key appears once and never again"
    ].join("\n");
    assert.equal(hasStrongRequirements(text, threshold), true);
  });

  it("accepts ticket bodies with code references and multiple sentences", () => {
    const text = [
      "Refactor the serializer in `src/services/user.ts`.",
      "It must preserve existing behavior. Definition of done covers unit tests.",
      "- Keep the public interface stable",
      "- Add coverage for null inputs",
      "- Update the documentation in src/utils/user.md"
    ].join("\n");
    assert.equal(hasStrongRequirements(text, threshold), true);
  });
});

describe("extractAcceptanceCriteria", () => {
  it("returns text after an 'Acceptance Criteria' heading", () => {
    const text = "Some intro.\nAcceptance Criteria:\n- Item one\n- Item two";
    assert.equal(extractAcceptanceCriteria(text), "- Item one\n- Item two");
  });

  it("matches the 'Definition of Done' variant", () => {
    const text = "Blah.\nDefinition of Done\nShip it.";
    assert.equal(extractAcceptanceCriteria(text), "Ship it.");
  });

  it("returns undefined when no section is present", () => {
    assert.equal(extractAcceptanceCriteria("Nothing to see here."), undefined);
  });
});
