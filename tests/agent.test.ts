import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildCodexExecArgs, buildCodexPrompt } from "../src/services/agent.js";
import type { JiraTicket } from "../src/types.js";

function ticket(overrides: Partial<JiraTicket> = {}): JiraTicket {
  return {
    key: "NEIRON-123",
    summary: "Refresh proposal details UI",
    description: "Use the proposal details example and address the whole ticket.",
    url: "https://neironhub.atlassian.net/browse/NEIRON-123",
    ...overrides
  };
}

function promptInput(overrides: Partial<Parameters<typeof buildCodexPrompt>[0]> = {}) {
  return {
    ticket: ticket({
      comments: [
        {
          authorName: "Grace Hopper",
          createdAt: "2026-04-19T09:00:00.000+0000",
          bodyText: "Please reuse the existing component composition."
        }
      ],
      humanComments: ["Please reuse the existing component composition."]
    }),
    repoPath: "/tmp/repo",
    mode: "implementation" as const,
    ticketContextPath: "docs/tickets/NEIRON-123.md",
    visualReviewPlanPath: "docs/tickets/NEIRON-123.visual-plan.json",
    visualReviewReportPath: "docs/tickets/NEIRON-123.visual-review.md",
    atlassianMcpEnabled: true,
    atlassianMcpAvailable: true,
    reviewFindingsPath: undefined,
    jiraImagePaths: [],
    jiraHtmlExamplePaths: [],
    repoContextPaths: [".html_examples/ProposalDetailsPage.html"],
    inlineHtmlExamples: [],
    jiraAssetManifestPath: undefined,
    ...overrides
  };
}

describe("buildCodexPrompt", () => {
  it("instructs Codex to fetch the live Jira ticket through Atlassian MCP when available", () => {
    const prompt = buildCodexPrompt(promptInput());

    assert.match(prompt, /Atlassian MCP is available/);
    assert.match(prompt, /fetch the live Jira issue by URL or key/);
    assert.match(prompt, /Treat the pre-fetched Jira data below as fallback context/);
  });

  it("falls back to the pre-fetched Jira snapshot when Atlassian MCP is unavailable", () => {
    const prompt = buildCodexPrompt(
      promptInput({
        atlassianMcpAvailable: false
      })
    );

    assert.match(prompt, /Atlassian MCP was requested/);
    assert.match(prompt, /pre-fetched Jira snapshot below as the source of truth/);
  });

  it("omits Atlassian MCP instructions when the feature is disabled", () => {
    const prompt = buildCodexPrompt(
      promptInput({
        atlassianMcpEnabled: false,
        atlassianMcpAvailable: false
      })
    );

    assert.doesNotMatch(prompt, /Atlassian MCP/);
  });
});

describe("buildCodexExecArgs", () => {
  it("includes the configured Codex profile when provided", () => {
    const args = buildCodexExecArgs({
      model: "gpt-5.4",
      outputPath: "/tmp/last-message.txt",
      prompt: "Implement the ticket",
      profile: "work"
    });

    assert.deepEqual(args.slice(0, 4), ["exec", "--profile", "work", "-a"]);
  });

  it("omits the profile flag when no profile is configured", () => {
    const args = buildCodexExecArgs({
      model: "gpt-5.4",
      outputPath: "/tmp/last-message.txt",
      prompt: "Implement the ticket"
    });

    assert.deepEqual(args.slice(0, 2), ["exec", "-a"]);
  });
});
