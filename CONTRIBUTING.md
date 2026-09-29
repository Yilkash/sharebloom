# Contributing to Sharebloom

## Working conventions

- Keep UI components in `apps/web/src/components/payments`.
- Keep browser state and actions in `apps/web/src/hooks`.
- Keep wallet utilities and shared validation in `apps/web/src/lib`.
- Keep secrets, database access, SERV calls and chain reads in `apps/web/src/server`.
- Keep Next.js route files small: they connect framework entry points to feature code.
- Put contract code, deployment scripts and contract tests in `contracts`.
- Record decisions, evidence and unresolved dependencies in `docs`.

Comment the reason for a security or recovery decision, especially transaction matching, signing claims and unknown outcomes. Avoid comments that repeat the code.

## Formatting

From `apps/web`:

```bash
npm ci
npm run format
npm run format:check
npm run build
```

From `contracts`:

```bash
forge fmt
forge build --skip test
```

Existing Solidity tests are in `contracts/test`. Run `forge test -vv` for the contract suite. Use `npm test` and `npm run test:browser` from the web directory for backend and browser checks; see docs/RELIABILITY.md for setup and isolation.

## Commits

Use small commits with a clear scope and purpose, for example:

- `feat(contracts): add testnet payment faucet`
- `refactor(web): separate payment UI and request handlers`
- `docs(steward): describe deployment and recovery limits`

Review staged paths before committing. Update CHANGELOG.md for meaningful milestones.

## Local configuration

Copy `apps/web/.env.example` to `apps/web/.env.local`. Keep keys, keystores, databases, generated build output and dependency folders out of commits. Use the example file to document configuration names without secrets.

Live transfers must use the configured testnet token. The backend never signs for the user. Preserve explicit wallet approval, full recipient review, exact integer token amounts, and receipt matching when changing the payment flow.
