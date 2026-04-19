# History Cleanup Guide

The current working tree now stops tracking `node_modules/` and `dist/`, but those paths still exist in git history. If you want a clean public history before wider launch, use a coordinated history rewrite.

Do not do this casually on an active shared branch. A rewrite changes commit IDs and requires a force push plus teammate coordination.

## Recommended Approach

Use `git filter-repo` in a fresh clone.

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

Before a public launch, run a dedicated scan across the rewritten repository history. Tools commonly used for this include:

- GitHub secret scanning
- `gitleaks`
- organization-specific secret scanning tooling

Example with `gitleaks` if you have it installed:

```bash
gitleaks detect --source .
```

## After The Rewrite

- Force-push with intention
- Update open pull requests if needed
- Tell contributors to re-clone or rebase against the rewritten history
- Tag the cleaned baseline so future contributors know where public history starts
