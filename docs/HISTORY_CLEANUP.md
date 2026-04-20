# History Cleanup Guide

The current working tree now stops tracking `node_modules/` and `dist/`, but those paths still exist in git history. If you want a clean public history before wider launch, use a coordinated history rewrite.

Do not do this casually on an active shared branch. A rewrite changes commit IDs and requires a force push plus teammate coordination.

## Recommended Approach

Use `git filter-repo` in a fresh clone.

The repository now includes a helper script that creates a disposable mirror clone, rewrites history there, and leaves your current working tree untouched:

```bash
./scripts/prepare-public-history.sh
```

You can also point it at a specific source repo and output directory:

```bash
./scripts/prepare-public-history.sh https://github.com/pterenin/CodePipeline.git /tmp/codepipeline-public-history.git
```

## High-Level Steps

1. Create a fresh backup clone of the repository.
2. Confirm exactly what you want removed from history.
3. Rewrite history in the backup clone.
4. Inspect the result carefully.
5. Force-push only after coordinating with collaborators.
6. Ask collaborators to re-clone or hard-reset to the new history baseline.

## Example: Remove Build And Dependency Artifacts From All History

```bash
git clone --mirror https://github.com/pterenin/CodePipeline.git codepipeline-cleanup.git
cd codepipeline-cleanup.git
git filter-repo --invert-paths --path node_modules --path dist
```

## Example Checks Before Pushing

Inspect whether the paths are still present:

```bash
git log --all -- node_modules dist
```

Review large objects:

```bash
git count-objects -vH
```

Review environment-related history:

```bash
git log --all -- .env .env.example
```

## Secret Scanning

Before a public launch, run a dedicated scan across the rewritten repository history. This repo now includes:

- `.gitleaks.toml` for public placeholder allowlisting
- `.github/workflows/secret-scan.yml` for continuous scanning in GitHub Actions

Example local scan with Dockerized `gitleaks`:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest \
  git /repo --no-banner --redact --config /repo/.gitleaks.toml
```

## After The Rewrite

- Force-push with intention
- Update open pull requests if needed
- Tell contributors to re-clone or rebase against the rewritten history
- Tag the cleaned baseline so future contributors know where public history starts
