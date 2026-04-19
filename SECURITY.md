# Security Policy

## Supported Use

CodePipeline is currently an experimental self-hosted project. Treat it as beta software and review all generated changes before merging or deploying them.

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

For now, report security problems directly to the maintainer through a private GitHub security advisory or a private maintainer contact channel. If you are unsure whether something is security-sensitive, err on the side of private reporting.

## Operational Guidance

- Use dedicated service accounts for Jira and GitHub
- Scope tokens as narrowly as possible
- Avoid using direct commit mode on protected or business-critical branches until you are confident in your setup
- Keep logs, `.env` files, and local workspaces private
- Test against repositories you control before pointing the worker at a production codebase
