<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (Duis)

- The plan lives in `doc/` (start with `doc/README.md`). Work phase by phase (`doc/06-implementation-phases.md`); ask the owner before changing a recorded decision.
- npm only. Use official CLIs and check `--help` first; record new decisions in `doc/02-architecture.md#decision-log` and `doc/adr/`.
- Respect the layering and import boundaries (`doc/04-folder-structure.md` §7, enforced by ESLint).
- Business actions are `defineOperation({ name, access, input, handler })` services (`src/server/operation.ts`): authorize first, validate with Zod, audit staff mutations, enqueue jobs and revalidation inside the transaction. New operations appear in the RBAC matrix test automatically — update `doc/permissions.md`.
- Never import `react-dom/server` from code the web app can reach; emails render in the worker (`src/server/notifications/render.tsx`).
- Money is integer paise. Prices, discounts, tax, stock and permissions are decided on the server only; authorize inside every Server Action and service.
- Builds have no database access: DB-backed rendering must sit behind `connection()` or another request-time API (`doc/adr/0016-no-database-at-build-time.md`).
- Before finishing: `npm run check`, plus `npm run test:integration` and `npm run test:e2e` when behaviour changed.
