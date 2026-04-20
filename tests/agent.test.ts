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

  it("mentions attached Jira screenshots when image inputs are present", () => {
    const prompt = buildCodexPrompt(
      promptInput({
        jiraImagePaths: ["/tmp/repo/.jira-assets/NEIRON-123/mockup.png"]
      })
    );

    assert.match(prompt, /Jira screenshots are attached/);
    assert.match(prompt, /image inputs directly/);
  });

  it("makes implementation mode refresh the context markdown and visual plan before coding", () => {
    const prompt = buildCodexPrompt(promptInput());

    assert.match(prompt, /Your first task is to analyze the whole ticket/);
    assert.match(prompt, /Refresh this exact file: docs\/tickets\/NEIRON-123\.md/);
    assert.match(
      prompt,
      /Also create or refresh this exact visual review plan JSON: docs\/tickets\/NEIRON-123\.visual-plan\.json/
    );
    assert.match(prompt, /continue directly into implementation in the same run/);
    assert.match(prompt, /re-check the whole ticket, acceptance criteria, human comments/);
  });

  it("tells Codex to search .html_examples when the ticket implies an HTML example without an exact repo path", () => {
    const prompt = buildCodexPrompt(
      promptInput({
        repoContextPaths: []
      })
    );

    assert.match(prompt, /search the repository's `?\.html_examples\/`? folder/i);
    assert.match(prompt, /use that file as required context/i);
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

    assert.deepEqual(args.slice(0, 5), ["-a", "never", "exec", "--profile", "work"]);
  });

  it("omits the profile flag when no profile is configured", () => {
    const args = buildCodexExecArgs({
      model: "gpt-5.4",
      outputPath: "/tmp/last-message.txt",
      prompt: "Implement the ticket"
    });

    assert.deepEqual(args.slice(0, 3), ["-a", "never", "exec"]);
  });

  it("attaches Jira screenshots as Codex image inputs when provided", () => {
    const args = buildCodexExecArgs({
      model: "gpt-5.4",
      outputPath: "/tmp/last-message.txt",
      prompt: "Implement the ticket",
      imagePaths: ["/tmp/one.png", "/tmp/two.png"]
    });

    assert.deepEqual(args.slice(-5), [
      "-i",
      "/tmp/one.png",
      "-i",
      "/tmp/two.png",
      "Implement the ticket"
    ]);
  });
});
