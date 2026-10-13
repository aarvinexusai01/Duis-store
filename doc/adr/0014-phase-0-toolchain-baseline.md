# ADR-0014: Phase 0 toolchain baseline

- Status: Accepted
- Date: 2026-10-13
- Deciders: Engineering (Phase 0), checked against the npm registry and the docs bundled with Next.js 16.4

## Context

Phase 0 had to settle tool versions that the plan left open (⚠ Verify items 1–3 in doc/10 §5). The facts below were checked on the date above.

## Decisions

| Area | Decision | Why |
|---|---|---|
| TypeScript | **5.x** (what `create-next-app@16.4.0` installs) | TypeScript 7 works for `next build` (Next runs the project's `tsc` CLI), but it has no JavaScript compiler API yet, and `typescript-eslint` (used by `eslint-config-next`) depends on that API. Revisit when typescript-eslint supports TS 7. |
| ESLint | **9.x**, not 10 | ESLint 10 runs, but `eslint-plugin-react`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` (bundled by `eslint-config-next`) don't declare ESLint 10 support and may call removed APIs. ESLint 9 is out of upstream support, but it only lints our own code. Upgrade when `eslint-config-next` does. |
| Drizzle | **drizzle-orm 0.45.x / drizzle-kit 0.31.x** (closes ADR-013's revisit) | 1.0 is still `rc.4`. We use the SQL-like query builder for most queries, which keeps the later upgrade small. |
| UI base | **shadcn/ui on Base UI** (preset `base-nova`), not Radix | shadcn CLI 4.21's default is now Base UI. It is actively developed by the team behind Radix and Material UI, and shadcn components keep the same API. shadcn's own `cn` package (MIT, maintained by shadcn) replaces `clsx` + `tailwind-merge`. |
| Server bundles | **esbuild** (`scripts/build-server-bundles.mjs`), not tsup | tsup 8.5 pins esbuild 0.27, which is affected by GHSA-67mh-4wv8-2f99. esbuild 0.28.2 isn't, and we need no type-declaration output. One fewer dependency layer. |
| Forms | shadcn `field` + react-hook-form (installed when first used) | shadcn v4 replaced the `form` component with `field`. |
| Lint boundaries | ESLint's built-in `no-restricted-imports` with one generated config per feature | No extra plugin needed. Probed with deliberate violations (cross-feature internals, `../../` imports, DB client in routes, `sql.raw`). |

## Accepted risks

`npm audit` reports advisories only in development tools (`eslint-config-next` → `fast-glob` → `braces`; `drizzle-kit` → `@esbuild-kit` → old esbuild). No fixed versions exist, and none of them reach the runtime image. CI gates on `npm audit --omit=dev --audit-level=high`, which is clean.

## Consequences

Upgrades to TS 7, ESLint 10 and Drizzle 1.0 are tracked by Dependabot and revisited each quarter.
