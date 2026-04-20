# Troubleshooting

Common recovery procedures when a CodePipeline run misbehaves or gets interrupted.

## Workspace Layout

CodePipeline stages all per-run state under `WORK_ROOT` (defaults to `./workdir`):

- `WORK_ROOT/repo-mirror` — the persistent git mirror of the target repository
- `WORK_ROOT/worktrees/<TICKET>-<timestamp>` — one directory per run

The worker creates a fresh worktree on every run and removes it on clean exit. An aborted process, crashed host, or killed container can leave both the on-disk directory and the linked entry in the mirror's `git worktree list`.

## Symptoms

- `git worktree add` fails with `fatal: '<path>' already exists`
- `git worktree add` fails with `fatal: 'refs/heads/ai/<ticket>-...' is already checked out`
- The dashboard shows a run stuck in `running` with no progress
- Disk usage under `WORK_ROOT/worktrees` grows across runs

## Clean A Stale Worktree

Run inside the mirror so git updates both the directory and its bookkeeping entry:

```bash
cd $WORK_ROOT/repo-mirror
git worktree list
git worktree remove --force ../worktrees/<TICKET>-<timestamp>
git worktree prune
```

If the directory was deleted out from under git and `remove` refuses:

```bash
cd $WORK_ROOT/repo-mirror
git worktree prune
```

`prune` drops entries whose on-disk path no longer exists.

## Clean A Stale Branch

The worker creates branches of the form `ai/<ticket>-<slug>`. A killed run can leave one behind in the mirror:

```bash
cd $WORK_ROOT/repo-mirror
git branch -D ai/<ticket>-<slug>
```

Only delete branches that are not currently in use by another worktree (`git worktree list` shows checkouts).

## Full Workspace Reset

If state is corrupted or you just want a clean slate, stop the server first and then:

```bash
rm -rf $WORK_ROOT
```

The next run will recreate the mirror from `GIT_REMOTE_URL`. This is safe: the mirror is a cache, not a source of truth. No remote branches are affected.

## Recover From An Interrupted Run

The in-memory run state does not persist across restarts, so the dashboard forgets the run when the process stops.

1. Restart the server.
2. Check whether the ticket was already labeled with `JIRA_DONE_LABEL` or transitioned — if yes, the run finished before the crash.
3. If a branch exists on the remote (`origin/ai/<ticket>-...`) and validation had passed, finish the workflow manually by opening the pull request yourself, or delete the remote branch and rerun.
4. Clean any leftover local worktree/branch using the steps above before rerunning.

## Dry Run For Recovery Verification

Use dry-run mode to confirm the environment and guardrails without touching Jira, GitHub, or remote branches:

```bash
curl -X POST "http://localhost:3000/run-next?dryRun=true"
```

Or flip `DRY_RUN_BY_DEFAULT=true` in `.env` while validating a new environment.

## Visual Review Browser Failures

If visual review fails to launch Chromium:

```bash
npm run playwright:install
```

Re-run the worker. Inside the provided Docker image the browser is already installed.

## Where To Look Next

- Operational model: [SECURITY.md](../SECURITY.md)
- Deployment specifics: [DEPLOYMENT.md](DEPLOYMENT.md)
- History cleanup before going public: [HISTORY_CLEANUP.md](HISTORY_CLEANUP.md)
