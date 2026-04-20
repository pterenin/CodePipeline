# Deployment Guide

This project now includes a Dockerfile and a simple Compose setup for self-hosted deployments.

## What The Container Includes

- Node.js runtime
- Playwright base image so Chromium-based visual review can run without extra OS package setup
- Production application dependencies
- Codex CLI installed globally from `@openai/codex`

## Recommended Environment Setup

Use a dedicated `.env` file with service-account credentials and keep it out of version control.

For a cautious first deployment, consider setting:

```env
DRY_RUN_BY_DEFAULT=true
```

That lets you verify Jira fetch, repository preparation, Codex execution, and validation before allowing push, pull request creation, or Jira mutations.

The container needs outbound access to:

- Jira
- GitHub
- OpenAI
- Any git remote used by `GIT_REMOTE_URL`

## Easiest Git Remote Setup

For containerized deployments, the simplest option is usually an HTTPS remote with a machine token instead of SSH. Example:

```env
GIT_REMOTE_URL=https://github.com/your-org/your-repo.git
```

If you prefer SSH, mount SSH keys or an agent socket into the container and make sure known hosts are configured.

## Run With Docker Compose

1. Create and fill in `.env`.
2. Build and start the service.

```bash
docker compose up --build -d
```

If you use a non-default env file name, set `CODEPIPELINE_ENV_FILE` and pass the same file to Compose interpolation:

```bash
CODEPIPELINE_ENV_FILE=.env.production docker compose --env-file .env.production up --build -d
```

3. Follow logs.

```bash
docker compose logs -f
```

4. Stop the service.

```bash
docker compose down
```

## Persistent Work Directory

The Compose file bind-mounts `./workdir` into `/app/workdir` so the persistent repo mirror and ticket worktrees survive container restarts.

## Notes

- If you do not need browser-based visual review, set `VISUAL_REVIEW_ENABLED=false`.
- Validation commands can be customized with `VALIDATION_COMMANDS`.
- The app still serves its dashboard from the same HTTP process.
- The Docker image is intended for self-hosting, not a managed multi-tenant deployment.
