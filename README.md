# Duis

Self-hosted men's fashion e-commerce platform: storefront (`/`), admin portal (`/admin`) and CMS (`/admin/cms`) in one Next.js 16 application, backed by PostgreSQL 18 and deployed with Docker.

The full plan (requirements, architecture, phases, database design, deployment) is in [`doc/`](doc/README.md). **Current status: Phase 1 (backend foundation) complete** — next is Phase 2, the storefront.

## Requirements

| Tool             | Version                                                  |
| ---------------- | -------------------------------------------------------- |
| Node.js          | 24 LTS (see `.nvmrc`)                                    |
| npm              | 11+ (npm is the only package manager used)               |
| Docker + Compose | Docker Engine 28+ / Compose v2 (Docker Desktop on macOS) |

## Quick start

```bash
cp .env.example .env      # local development values
npm ci                    # install exactly what package-lock.json pins
npm run db:up             # PostgreSQL 18 + Mailpit (waits until healthy)
npm run db:migrate        # create the tables (as the duis_owner role)
npm run db:seed           # demo catalogue, collections, CMS content and accounts (~1 min)
npm run dev               # http://localhost:3000 (next free port if taken)
npm run worker            # in a second terminal: background jobs (emails, refreshes)
```

Seeded development accounts (password `Duis-dev-Passw0rd!`, development only): `superadmin@duis.local`, `storeadmin@duis.local`, `contentmanager@duis.local`, `contenteditor@duis.local`, `fulfilmentstaff@duis.local`, `supportagent@duis.local` and `customer@duis.local`. Staff accounts must set up two-factor authentication at first sign-in. With the fake SMS provider, phone OTP codes are printed in the dev server log.

- Mailpit catches all outgoing email: <http://localhost:8025>
- The first `npm run db:up` creates the database roles and extensions from `docker/postgres/initdb/`.

## Commands

| Command                                      | What it does                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                | Development server (Turbopack)                                                                           |
| `npm run build`                              | Production build (`.next/standalone`)                                                                    |
| `npm start`                                  | Run the standalone production build, as the Docker image does                                            |
| `npm run build:server`                       | Bundle the worker, migrate, seed and admin CLI entry points into `dist/` (esbuild)                       |
| `npm run worker`                             | Run the background worker (`dist/worker.mjs`)                                                            |
| `npm run lint` / `lint:fix`                  | ESLint, including import-boundary rules                                                                  |
| `npm run typecheck`                          | Generate route types and run `tsc`                                                                       |
| `npm run format` / `format:check`            | Prettier (with Tailwind class sorting)                                                                   |
| `npm test`                                   | Unit tests (Vitest)                                                                                      |
| `npm run test:integration`                   | Integration tests on a fresh `duis_test` database (rebuilt every run) and Mailpit                        |
| `npm run test:e2e`                           | Playwright against the production build on port 3100 (`npm run build` first; `npm run e2e:install` once) |
| `npm run check`                              | Lint, types, format check and unit tests                                                                 |
| `npm run db:up` / `db:down`                  | Start / stop local services (data kept in a Docker volume)                                               |
| `npm run db:generate`                        | Generate a SQL migration from `src/db/schema`                                                            |
| `npm run db:migrate`                         | Apply migrations (as the `duis_owner` role)                                                              |
| `npm run db:studio`                          | Drizzle Studio                                                                                           |
| `npm run db:seed`                            | Load deterministic demo data (refuses staging/production, and refuses to run twice)                      |
| `npm run db:reset`                           | **Local only:** delete the dev database volume and media, then recreate and migrate                      |
| `npm run admin:create -- --email … --name …` | Create the first super admin (password from `ADMIN_PASSWORD`, or generated and shown once)               |
| `npm run auth:generate`                      | Regenerate `src/db/schema/auth.ts` with the Better Auth CLI after changing auth plugins                  |

## Project structure

```
src/
  app/        routes, layouts, route handlers (thin)
  components/ design system (shadcn/ui on Base UI) and shared UI
  features/   domain modules: catalog, inventory, collections, media, cms
  server/     operations, auth, db, jobs, notifications, storage, cache, security
  emails/     email templates (React, rendered by the worker)
  cli/        admin command-line tools
  db/         Drizzle schema, migrations, migrate script, demo seed
  worker/     background worker entry point
  config/     validated environment
  lib/        framework-free utilities
tests/        integration and e2e tests (unit tests sit next to the code)
docker/       PostgreSQL init scripts (Caddy/backup configs arrive in Phase 7)
scripts/      build and run helpers
doc/          plan, decisions (doc/adr), runbooks
```

Import rules are enforced by ESLint: see [doc/04-folder-structure.md §7](doc/04-folder-structure.md#7-boundary-rules-enforced-with-eslint). Who may call each service operation is listed in [doc/permissions.md](doc/permissions.md).

## Database roles

| Role            | Used by                                    | Can                                           |
| --------------- | ------------------------------------------ | --------------------------------------------- |
| `duis_owner`    | migrations only (`MIGRATION_DATABASE_URL`) | DDL in `public`                               |
| `duis_app`      | web and worker (`DATABASE_URL`)            | DML in `public`; owns the `pgboss` job schema |
| `duis_readonly` | reporting, backup checks                   | read only                                     |

## Docker image

One image serves three roles:

```bash
docker build --build-arg APP_SHA=$(git rev-parse --short=12 HEAD) -t duis-web:$(git rev-parse --short=12 HEAD) .
# web (default):  node server.js
# worker:         node dist/worker.mjs
# migrate:        node dist/migrate.mjs
# first admin:    node dist/create-super-admin.mjs --email … --name …
```

The image never contains `.env` files; configuration comes from the environment at runtime. Production Compose, Caddy, backups and deploy scripts arrive in Phase 7 ([doc/07-deployment-operations.md](doc/07-deployment-operations.md)).

## Conventions

- **npm only**, lockfile committed, `npm ci` in CI and Docker.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`…).
- **Money** in integer paise; prices, stock and permissions decided on the server only.
- **Migrations** are generated, reviewed as SQL, and backward compatible (expand/contract).
- **Decisions** go in the [decision log](doc/02-architecture.md#decision-log) and `doc/adr/`.

## Troubleshooting

| Symptom                                      | Fix                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Cannot reach PostgreSQL at DATABASE_URL`    | `npm run db:up`; check Docker Desktop is running                                                            |
| Port 3000 already in use                     | `next dev` picks the next free port; e2e tests use 3100                                                     |
| Changed role passwords have no effect        | init scripts run only on an empty volume: `docker compose -f compose.dev.yaml down -v` (deletes local data) |
| `Invalid environment configuration` on start | compare `.env` with `.env.example`; the message lists the failing keys                                      |
