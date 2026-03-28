# Jira AI Worker

`jira-ai-worker` is a conservative Node.js + TypeScript service that processes one Jira issue at a time from a configured queue, prepares an isolated git worktree from a persistent local mirror, asks an OpenAI-backed agent to make the smallest reasonable code change, validates the result, and opens a draft GitHub pull request when the run succeeds.

The first version is intentionally cautious:

- It only processes issues returned by a configurable JQL filter.
- It skips tickets with weak requirements or risky keywords.
- It never runs more than one ticket at a time.
- It always creates draft pull requests.
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
- `JIRA_JQL`: Optional full JQL override. If set, it takes precedence over the project-based settings.
  The service still automatically excludes tickets already labeled `ai-done`.

### GitHub

- `GITHUB_API_BASE_URL`: Usually `https://api.github.com`.
- `GITHUB_TOKEN`: GitHub token for creating pull requests.
- `GITHUB_OWNER`: Repository owner or organization.
- `GITHUB_REPO`: Repository name.

### Git / Workspace

- `GIT_REMOTE_URL`: Git clone URL for the target repository.
- `GIT_BASE_BRANCH`: Base branch to branch from and target in pull requests.
- `WORK_ROOT`: Root directory where the persistent repo mirror and per-ticket worktrees are created.

### OpenAI

- `OPENAI_API_KEY`: API key for the coding agent.
- `OPENAI_MODEL`: Model name used for implementation and repair prompts.
- `OPENAI_MAX_CONTEXT_FILES`: Max number of repository files that can be loaded into active model context at once.
- `OPENAI_MAX_FILE_BYTES`: Max bytes per file snippet sent to the model.
- `OPENAI_CONTEXT_ROUNDS`: Number of iterative context-request rounds allowed before the agent must decide.
- `OPENAI_MAX_SEARCH_RESULTS`: Max number of `rg` discovery matches stored per query.
- `VALIDATION_REPAIR_ATTEMPTS`: Max number of automated repair attempts after validation failures. Defaults to `5`.

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
2. Applies safety checks for missing requirements and risky keywords.
3. Refreshes a persistent local mirror of the target repository and creates a fresh per-ticket git worktree.
4. Creates a branch named `ai/JIRA-123-short-slug`.
5. Uses `rg`-based repository discovery, loads an initial focused context, and lets the OpenAI agent request more files in multiple rounds before producing a patch.
6. Runs validation commands in order:
   - `npm ci`
   - `npm run lint`
   - `npm run typecheck`
   - `npm test -- --runInBand`
7. If validation fails, performs up to the configured number of repair attempts with validation output.
8. Commits and pushes the branch if files changed.
9. Creates a draft GitHub pull request.
10. Comments back to Jira with the PR link or failure outcome, and labels successful tickets with `ai-done`.

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

- runs repository discovery with `rg --files` and targeted search terms from the Jira ticket
- gathers a focused initial snapshot instead of a simple fixed traversal
- lets the model request additional files dynamically in multiple rounds
- asks the model for either more context, direct file edits, or a human-review decision
- writes the returned file changes directly into the isolated worktree
- performs repeated repair passes if validation fails, up to the configured limit

You can replace the prompt strategy, the model, or the patch application mechanism later without changing Jira, GitHub, validation, or worker orchestration.

## Operational Notes

- This service does not include a database in v1.
- Run history is not persisted across restarts.
- The worker assumes the target repository uses the specified npm-based validation commands.
- Draft PR creation and Jira comments are best-effort but surfaced in the API response and logs.

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
