# Contributing

Thanks for contributing to this project.

## Before You Start

- Use Node.js `>=20` and `pnpm` (see `package.json` engines).
- Install dependencies:

```bash
pnpm install
```

- Copy `.env.example` to `.env` and fill any values needed for your local run.
- Never commit secrets (`.env`, API keys, tokens, private URLs).

## Development Workflow

1. Create a feature/fix branch from the default branch.
2. Keep changes focused on a single purpose.
3. Add or update tests when behavior changes.
4. Open a pull request using the repository PR template.

## Required Checks Before Review

Run all of the following locally before requesting review:

```bash
pnpm format:check
pnpm typecheck
pnpm test
```

Equivalent combined check:

```bash
pnpm check
```

## Pull Request Requirements

A PR is considered ready for maintainer review only when:

- Formatting, typecheck, and tests pass locally.
- GitHub Actions checks pass for the PR.
- Behavior changes include test coverage updates.
- The PR description clearly explains:
  - what changed,
  - why it changed,
  - how it was validated.
- No unrelated refactors are bundled with the PR.

PRs that fail required checks may be closed or asked to rework before review.

## Commit and Scope Guidelines

- Make small, logically grouped commits.
- Prefer clear commit messages that explain intent.
- Avoid broad drive-by cleanups in feature PRs.

## Reporting Security Issues

Do not open public issues for vulnerabilities. Follow `docs/SECURITY.md`.
