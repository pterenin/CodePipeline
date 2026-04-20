# Security Policy

## Supported Use

CodePipeline is currently an experimental self-hosted project. Treat it as beta software and review all generated changes before merging or deploying them.

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use GitHub's private vulnerability reporting for this repository:

1. Go to <https://github.com/pterenin/CodePipeline/security/advisories/new>
2. Describe the issue, how to reproduce it, and any suggested mitigation
3. The maintainer will acknowledge receipt within 7 days

If you cannot use GitHub's advisory flow, contact the repository owner through their GitHub profile (<https://github.com/pterenin>) and request a private channel before sharing details.

Expectations:

- Acknowledgement: within 7 days
- Initial assessment and severity estimate: within 14 days
- Coordinated disclosure timeline is negotiated per report; 90 days is the default ceiling

If you are unsure whether something is security-sensitive, err on the side of private reporting.

## Scope

In scope:

- The CodePipeline worker, dashboard, API, and bundled scripts in this repository
- The `.github/workflows` shipped in this repository

Out of scope:

- Vulnerabilities in Codex CLI, OpenAI services, Jira, GitHub, Playwright, or other upstream dependencies (report upstream)
- Findings that require an attacker to already hold the tokens configured in `.env`
- Generated output of Codex CLI against arbitrary target repositories

## Operational Guidance

- Use dedicated service accounts for Jira and GitHub
- Scope tokens as narrowly as possible (pull-request creation for GitHub; issue read and comment/transition for Jira)
- Avoid using direct commit mode on protected or business-critical branches until you are confident in your setup
- Keep `JIRA_DONE_LABEL`, `JIRA_REVIEW_TRANSITION_NAME`, and `JIRA_COMMENT_PREFIX` under review so automation is distinguishable from human activity in Jira
- Keep logs, `.env` files, and local `WORK_ROOT` contents private — worktrees can contain source code from the target repository
- Treat the built-in hard-blocked keyword list in `src/config.ts` as a deny list, not a substitute for code review
- Test against repositories you control before pointing the worker at a production codebase
- Start new environments with `DRY_RUN_BY_DEFAULT=true` and flip it off only after a clean successful run

## Threat Model Summary

CodePipeline is designed to be run by a trusted operator on infrastructure the operator controls.

Assumed trusted:

- The host running the worker
- The operator's local checkout of this repository
- The contents of `.env`
- The Codex CLI binary and the repository it is pointed at

Assumed untrusted:

- Jira ticket text and attachments (treated as input, not instructions)
- The generated diff — always reviewed by a human through a draft pull request unless direct-commit mode is explicitly enabled on a non-`main` branch

Known amplifiers of blast radius:

- `GIT_DIRECT_COMMITS=true` bypasses the pull-request review step
- Broadly scoped Jira or GitHub tokens
- Weakening `src/utils/guardrails.ts` without a compensating review process
