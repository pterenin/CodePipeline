# Jira AI Worker

`jira-ai-worker` is a conservative Node.js + TypeScript service that processes one Jira issue at a time from a configured queue, prepares an isolated git worktree from a persistent local mirror, asks an OpenAI-backed agent to make the smallest reasonable code change, validates the result, and then either opens a draft GitHub pull request or commits directly to the configured base branch when the run succeeds.

The first version is intentionally cautious:

- It only processes issues returned by a configurable JQL filter.
- It skips tickets with weak requirements or hard-blocked keywords such as secrets, infrastructure, or deployment work.
- It never runs more than one ticket at a time.
- It creates draft pull requests by default.
- It can optionally commit directly to a non-`main` base branch after validation.
- It never merges automatically.
- It keeps state in memory and targets a single repository.

## Project Structure

```text
src/
  index.ts
  config.ts
  types.ts
  worker.ts
  services/
    agent.ts
    git.ts
    github.ts
    jira.ts
    validator.ts
  utils/
    files.ts
    logger.ts
    text.ts
```

## Requirements

- Node.js 22+ recommended
- Access to a Jira project and API token
- Access to the target GitHub repository and a token with PR permissions
- A git remote for the repository being automated
- An OpenAI API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template and fill in credentials:

```bash
cp .env.example .env
```

3. Build or run in watch mode:

```bash
npm run build
npm run dev
```

## Environment Variables

### Server

- `PORT`: HTTP port for the Express server.
- `LOG_LEVEL`: Simple log label for local runs.

### Jira

- `JIRA_BASE_URL`: Jira base URL, such as `https://company.atlassian.net`.
- `JIRA_EMAIL`: Jira user email for basic auth.
- `JIRA_API_TOKEN`: Jira API token.
- `JIRA_PROJECT_KEY`: Simpler project-based queue configuration if you do not want to provide a full JQL string.
- `JIRA_QUEUE_LABEL`: Optional label filter used with `JIRA_PROJECT_KEY`. Defaults to `ai-ready`.
- `JIRA_QUEUE_STATUS`: Optional status filter used with `JIRA_PROJECT_KEY`.
- `JIRA_FORCE_INCLUDE_KEYS`: Optional comma-separated Jira issue keys that should be included even if they do not match the normal queue label or status filters.
- `JIRA_JQL`: Optional full JQL override. If set, it takes precedence over the project-based settings.
  The service still automatically excludes tickets already labeled `ai-done`.

### GitHub

- `GITHUB_API_BASE_URL`: Usually `https://api.github.com`.
- `GITHUB_TOKEN`: GitHub token for creating pull requests.
- `GITHUB_OWNER`: Repository owner or organization.
- `GITHUB_REPO`: Repository name.

### Git / Workspace

- `GIT_REMOTE_URL`: Git clone URL for the target repository.
- `GIT_BASE_BRANCH`: Base branch to branch from and target in pull requests. When direct commits are enabled, this is also the branch that receives validated commits. The worker refreshes the configured branch in the persistent mirror, so changing this value does not require manually deleting `workdir/repo-mirror`.
- `GIT_DIRECT_COMMITS`: When `true`, validated changes are committed directly to `GIT_BASE_BRANCH` instead of opening a PR. For safety, if `GIT_BASE_BRANCH=main`, direct commits are disabled automatically and the regular PR flow is used.
- `WORK_ROOT`: Root directory where the persistent repo mirror and per-ticket worktrees are created.

### OpenAI

- `OPENAI_API_KEY`: API key available to the Codex CLI run.
- `OPENAI_MODEL`: Model name passed to Codex CLI for implementation and repair passes.
- `CODEX_CLI_PATH`: Path to the `codex` executable. Defaults to `codex`.
- `VALIDATION_REPAIR_ATTEMPTS`: Max number of automated repair attempts after validation failures. Defaults to `5`.

The worker explicitly runs Codex CLI with `-c model_reasoning_effort="xhigh"` so ticket analysis, implementation, review, and repair passes do not depend on per-user Codex config.

## API

### `GET /health`

Returns:

```json
{ "ok": true }
```

### `POST /run-next`

Triggers one serialized processing attempt for the next Jira issue that matches the configured Jira queue filter.

### `GET /api/run-state`

Returns the current in-memory workflow snapshot used by the UI.

### `GET /api/run-events`

Streams live workflow updates over Server-Sent Events.

### `POST /api/run`

Starts a worker run asynchronously for the browser UI. If a run is already active, the endpoint returns HTTP `409`.

Example response:

```json
{
  "ok": true,
  "status": "success",
  "ticketKey": "JIRA-123",
  "branchName": "ai/JIRA-123-fix-login-copy",
  "pullRequestUrl": "https://github.com/org/repo/pull/123"
}
```

If a run is already active, the endpoint returns HTTP `409`.

## Worker Flow

For each run, the service:

1. Reads the next issue from Jira using either the configured full JQL or a generated project-based queue query.
   Human Jira comments are included in full, and image or HTML example attachments on the issue are downloaded into a git-ignored local folder for the agent.
2. Applies safety checks for missing requirements and hard-blocked keywords.
3. Refreshes a persistent local mirror of the target repository and creates a fresh per-ticket git worktree.
4. Creates a branch named `ai/JIRA-123-short-slug`.
5. Launches a Codex context pass that analyzes the whole ticket, comments, and local Jira assets, then refreshes `docs/tickets/JIRA-123.md` before implementation begins.
6. Launches a Codex implementation pass inside the prepared git worktree so the agent can inspect the repository directly, reuse existing components, avoid copying HTML example structure verbatim, edit files locally, and run focused commands before stopping.
7. Launches a fresh Codex review pass that re-analyzes the ticket against the current implementation, refreshes `docs/tickets/JIRA-123.review.md`, and if needed sends findings back into one automated follow-up implementation pass before validation.
8. Runs validation commands in order:
   - `npm ci`
   - `npm run lint`
   - `npm run typecheck`
   - `npm test -- --runInBand`
9. If validation fails, performs up to the configured number of repair attempts with validation output.
10. Commits and pushes the branch if files changed.
11. Publishes the validated change:
   - by default, pushes a ticket branch and creates a draft GitHub pull request
   - if `GIT_DIRECT_COMMITS=true` and `GIT_BASE_BRANCH` is not `main`, commits directly to `GIT_BASE_BRANCH`
12. Comments back to Jira with the PR link or direct commit outcome, labels successful tickets with `ai-done`, and moves them to `In Review` when that transition is available.

## Frontend

Open `http://localhost:3000` to use the built-in dashboard. The page starts in an idle state, nothing runs automatically, and a new execution begins only when you press `Start`.

The UI shows:

- a React-powered dark-mode dashboard
- a node-based workflow canvas inspired by GitHub Actions and n8n
- connector lines between pipeline stages
- a spinner on the currently running step
- per-step details and outputs as they complete
- a live event feed and final run result payload

## Notes on the Agent

The agent layer is intentionally modular. Today it:

- runs Codex CLI directly inside the isolated ticket worktree
- refreshes a per-ticket markdown context file under `docs/tickets/` before implementation
- runs a fresh post-implementation review pass and stores structured findings in `docs/tickets/<ticket>.review.md`
- lets the agent inspect the full repository with local tools instead of relying on a preloaded file bundle
- includes full human Jira comment history plus downloaded Jira screenshots and HTML examples in the handoff
- leaves edits in the working tree for the existing validation, git, GitHub, and Jira stages
- performs repeated repair passes if validation fails, up to the configured limit

You can replace the prompt strategy, the model, or the patch application mechanism later without changing Jira, GitHub, validation, or worker orchestration.

## Operational Notes

- This service does not include a database in v1.
- Run history is not persisted across restarts.
- The worker assumes the target repository uses the specified npm-based validation commands.
- Draft PR creation, direct-commit reporting, and Jira comments are best-effort but surfaced in the API response and logs.

## Local Usage

Start the server:

```bash
npm run dev
```

Nothing runs automatically. Start a run from the browser UI or call `POST /run-next`.

Trigger a run:

```bash
curl -X POST http://localhost:3000/run-next
```

Check health:

```bash
curl http://localhost:3000/health
```
