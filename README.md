# Jira AI Worker

`jira-ai-worker` is a conservative Node.js + TypeScript service that pulls one Jira issue at a time from a configured queue, prepares an isolated git workspace, asks an OpenAI-backed agent to make the smallest reasonable code change, validates the result, and opens a draft GitHub pull request when the run succeeds.

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
- `JIRA_JQL`: JQL filter for automation-ready tickets.

### GitHub

- `GITHUB_API_BASE_URL`: Usually `https://api.github.com`.
- `GITHUB_TOKEN`: GitHub token for creating pull requests.
- `GITHUB_OWNER`: Repository owner or organization.
- `GITHUB_REPO`: Repository name.

### Git / Workspace

- `GIT_REMOTE_URL`: Git clone URL for the target repository.
- `GIT_BASE_BRANCH`: Base branch to branch from and target in pull requests.
- `WORK_ROOT`: Root directory where isolated working clones are created.

### OpenAI

- `OPENAI_API_KEY`: API key for the coding agent.
- `OPENAI_MODEL`: Model name used for implementation and repair prompts.
- `OPENAI_MAX_CONTEXT_FILES`: Number of repository files to include in prompts.
- `OPENAI_MAX_FILE_BYTES`: Max bytes per file snippet sent to the model.

## API

### `GET /health`

Returns:

```json
{ "ok": true }
```

### `POST /run-next`

Triggers one serialized processing attempt for the next Jira issue that matches the configured JQL.

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

1. Reads the next issue from Jira using the configured JQL.
2. Applies safety checks for missing requirements and risky keywords.
3. Clones the target repository into a fresh working directory.
4. Creates a branch named `ai/JIRA-123-short-slug`.
5. Builds lightweight repository context and asks the OpenAI agent for a minimal patch.
6. Runs validation commands in order:
   - `npm ci`
   - `npm run lint`
   - `npm run typecheck`
   - `npm test -- --runInBand`
7. If validation fails, performs one repair attempt with validation output.
8. Commits and pushes the branch if files changed.
9. Creates a draft GitHub pull request.
10. Comments back to Jira with the PR link or failure outcome.

## Notes on the Agent

The agent layer is intentionally modular. Today it:

- gathers a small repository snapshot
- asks the model for either a unified diff patch or a human-review decision
- applies the patch locally with `git apply`
- performs one repair pass if validation fails

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

Trigger a run:

```bash
curl -X POST http://localhost:3000/run-next
```

Check health:

```bash
curl http://localhost:3000/health
```
