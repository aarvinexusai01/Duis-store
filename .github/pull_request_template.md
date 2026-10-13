## What and why

<!-- What changes, and which plan phase or decision it belongs to (doc/06-implementation-phases.md). -->

## How it was verified

<!-- Commands run, tests added, screenshots for UI changes. -->

## Checklist

- [ ] `npm run check` passes (lint, types, format, unit tests)
- [ ] Integration / e2e tests added or updated where behaviour changed
- [ ] Database migrations are backward compatible (expand/contract) and reviewed as SQL
- [ ] Money stays in integer paise; prices, stock and permissions are enforced on the server
- [ ] No secrets, credentials or real customer data in code, tests or logs
- [ ] New dependencies are justified in this description
- [ ] Docs or an ADR updated if a decision changed (doc/02-architecture.md#decision-log)
