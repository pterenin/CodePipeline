# Roadmap

This document tracks the work needed to make CodePipeline a healthy public repository that other teams can evaluate, run, and contribute to safely. It is updated as phases land; completed items are kept for historical context.

## Goals

- Make the repository understandable to a new contributor in one pass
- Remove internal-only assumptions from the public surface
- Reduce the chance of accidental secret leakage or unsafe default behavior
- Provide the minimum community, security, and maintenance scaffolding expected from an open-source project

## Current Snapshot

- `npm run build` passes
- `npm run typecheck` passes
- `node_modules/` and `dist/` were historically committed and must be removed from version control before treating the repo as clean
- Public naming was inconsistent between `jira-ai-worker` and `CodePipeline`
- `.env.example` and `README.md` had drift from the actual runtime config
- The project still contains a few org-specific Jira conventions that should become configurable later

## Phase 1: Public Readiness

- [x] Create an explicit open-source readiness plan
- [x] Unify the public project name
- [x] Add OSS-facing project docs:
      `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, PR template
- [x] Add a license
- [x] Align `README.md` and `.env.example` with the current runtime behavior
- [x] Add basic package metadata for a public repository
- [x] Add basic CI for install, typecheck, and build
- [ ] Rewrite git history if needed so committed dependency/build artifacts never appear in the public baseline (see `docs/HISTORY_CLEANUP.md`, `scripts/prepare-public-history.sh`)
- [x] Run a dedicated secret scan across git history before broad announcement

## Phase 2: Productization

- [x] Make Jira success label configurable instead of hardcoding `ai-done`
- [x] Make the Jira follow-up transition target configurable instead of hardcoding `In Review`
- [x] Make the Jira comment prefix configurable instead of hardcoding `AI Agent:`
- [x] Make validation commands configurable per target repository
- [x] Add a safer dry-run mode for setup verification
- [x] Bundle dashboard assets locally instead of loading React from a CDN at runtime
- [x] Add a Docker-based deployment path

## Phase 3: Trust And Maintenance

- [x] Add targeted tests for text helpers and guardrails (run via `npm test`)
- [ ] Add targeted tests for config parsing, Jira query generation, and log redaction
- [x] Add a small demo fixture for no-credential evaluation (`npm run demo`, `fixtures/tickets/`)
- [x] Add screenshots to the README (`docs/screenshots/dashboard.png`, regenerable via `scripts/capture-dashboard.ts`)
- [x] Document the operational security model in more depth (`SECURITY.md`)
- [x] Document how to recover from interrupted runs and clean stale worktrees (`docs/TROUBLESHOOTING.md`)

## Risks To Watch

- Jira and GitHub tokens have broad operational impact, so service-account setup matters
- Direct commit mode is useful, but it raises the blast radius if validation or prompting is wrong
- The current system is intentionally conservative, but the documentation must keep that tone so users do not mistake it for an autonomous merge bot
- Publicizing the project before history cleanup can create avoidable trust and repo hygiene concerns

## Definition Of Done For Public Launch

- Clean public git history or a documented rationale for preserving existing history
- No tracked dependency or build artifacts in the working tree baseline
- Clear install and first-run instructions
- License and community docs in place
- CI running on pull requests
- At least one safe evaluation path documented for a new user
