# ADR-0015: Job queue transactions and database roles

- Status: Accepted (verified by tests/integration/jobs.test.ts and database.test.ts)
- Date: 2026-10-13

## Context

Two questions from Phase 0:

1. Can jobs be queued **inside** a business transaction, or do we need an outbox table? (⚠ Verify item 4.)
2. Which database role owns the pg-boss schema, given least-privilege roles (`duis_owner` for DDL, `duis_app` for runtime)?

## Findings

- pg-boss 12.37 ships `fromDrizzle(tx, sql)`. Passing `{ db: fromDrizzle(tx, sql) }` to `send()` writes the job through the Drizzle transaction.
- pg-boss migrates its own schema and also runs **background index builds** (`CREATE INDEX CONCURRENTLY`) from its maintenance loop. The role that runs the worker's pg-boss therefore needs DDL rights in that schema.
- `createQueue()` is idempotent (`ON CONFLICT DO NOTHING`). Queue names may contain `.`, so the plan's `domain.action` names work.

## Decision

1. **No outbox table.** Jobs that must follow a business change are sent with `{ db: fromDrizzle(tx, sql) }` inside `withTransaction()`. The integration test proves a rolled-back transaction leaves no job and a committed one does.
2. **Roles:**
   - `duis_owner` owns `public` (all application tables) and runs migrations. It is never used at runtime.
   - `duis_app` has DML only in `public` (enforced with default privileges, and tested: DDL is denied). It **owns the `pgboss` schema**, created by `docker/postgres/initdb/01-roles.sh`.
   - `duis_readonly` can read both schemas.
3. **pg-boss configuration:**
   - The worker runs with `migrate`, `supervise` and `schedule` on.
   - The web replicas only send jobs, with all three off.
   - `createSchema` is off everywhere, because the init script creates the schema.

## Consequences

- `duis_app` can alter tables in `pgboss` but not in `public`. This is acceptable because the app role can already modify all business data. Application DDL stays owner-only.
- `duis_app` has `statement_timeout = 15s`. If pg-boss maintenance ever needs longer, give the pg-boss pool its own setting (connection `options`), not the whole role.
