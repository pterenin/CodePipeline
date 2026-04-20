# Pipeline Context Implementation Plan

Status: Implemented on 2026-04-19.

## Goal

Make ticket-specific Codex runs behave more like the IDE workflow by carrying richer Jira context and exact repo-local example files into the prompt.

## Implemented Changes

1. Preserve richer Jira comment context.
   The worker now paginates through the full Jira comment history, keeps non-automation comment metadata, and still exposes plain-text comment bodies for existing guardrails and summaries.

2. Carry explicit repo-local context files into the prompt.
   When ticket text or comments mention paths such as `.html_examples/ProposalDetailsPage.html` or `NeironHub/.html_examples/ProposalDetailsPage.html`, the worker resolves those files inside the prepared repository and passes the exact local paths into Codex as required context.

3. Strengthen prompt wiring for ticket-fix work.
   Codex now receives the ticket browse URL, formatted Jira comments with author/date metadata, explicit repo-local context files, and stronger instructions to treat those inputs as required context before editing the repo.

4. Prefer live Jira reads through Atlassian MCP.
   When the local Codex CLI environment has Atlassian MCP enabled, the prompt now explicitly tells Codex to fetch the live Jira ticket and comments before relying on the pre-fetched snapshot. The worker also supports an optional `CODEX_PROFILE` setting so non-interactive runs can target the same Codex setup as the IDE.

5. Add focused regression coverage.
   Tests now cover repo-local path extraction and richer comment formatting so these prompt-context upgrades stay stable.

## Files Touched

- `src/services/jira.ts`
- `src/services/agent.ts`
- `src/types.ts`
- `src/utils/ticket-context.ts`
- `tests/ticket-context.test.ts`

## Notes

This rollout intentionally keeps the existing worker flow intact. It improves prompt fidelity first, without yet changing the multi-pass context, implementation, review, and validation stages.
