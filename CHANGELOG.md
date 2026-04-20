# Changelog

All notable changes to CodePipeline are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- First public-ready baseline of the self-hosted Jira-to-GitHub Codex worker
- Dashboard redesigned as an n8n-style pipeline flow with the per-ticket review stage surfaced
- Locally bundled dashboard assets built via esbuild (`scripts/build-dashboard.ts`)
- Ticket guardrails that hard-block unsafe keywords and require strong requirements before a run
- Configurable Jira surface: `JIRA_DONE_LABEL`, `JIRA_REVIEW_TRANSITION_NAME`, `JIRA_COMMENT_PREFIX`
- Configurable validation commands via `VALIDATION_COMMANDS` (JSON array or newline list)
- Dry-run worker mode (`DRY_RUN_BY_DEFAULT` and `?dryRun=true`) that skips publish and Jira mutations
- Docker and Compose deployment path ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))
- Git history cleanup guidance and helper script ([docs/HISTORY_CLEANUP.md](docs/HISTORY_CLEANUP.md), `scripts/prepare-public-history.sh`)
- CI workflow for install, typecheck, build, and tests
- Gitleaks-based secret-scan workflow
- Community docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates
- Unit tests for text helpers and ticket guardrails
- Troubleshooting guide covering stale worktrees and interrupted runs ([docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md))
- Public roadmap ([docs/ROADMAP.md](docs/ROADMAP.md))

### Changed

- Project renamed and unified under the public name `CodePipeline`
- README and `.env.example` brought in sync with the current runtime configuration

### Removed

- Historically tracked `node_modules/` and `dist/` artifacts (see `docs/HISTORY_CLEANUP.md` for preparing a clean public history)
