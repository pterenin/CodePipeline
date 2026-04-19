# Contributing

Thanks for contributing to CodePipeline.

## Before You Start

- Read [README.md](./README.md) for the project scope and current limitations
- Read [SECURITY.md](./SECURITY.md) before reporting vulnerabilities or handling credentials
- Keep in mind that this project automates changes against other repositories, so safety and clarity matter as much as feature velocity

## Local Setup

```bash
npm install
npm run playwright:install
cp .env.example .env
```

Fill in `.env` with your own local credentials and test against repositories you control.

## Local Checks

Run:

```bash
npm run check
```

## Pull Requests

- Keep pull requests focused and easy to review
- Update docs when behavior or configuration changes
- Call out safety implications when changing automation behavior, git publishing flow, or token handling
- Prefer conservative defaults over convenience when the tradeoff affects other repositories or production systems

## Good First Contributions

- Documentation improvements
- Config clarity and setup validation
- Tests around parsing, guardrails, and error handling
- Safer defaults and better observability

## Communication

If you are unsure whether a change belongs in the project, open an issue first so we can align on scope before implementation.
