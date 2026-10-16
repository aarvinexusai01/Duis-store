# Duis — Platform Plan

Planning documents for **Duis**, a self-hosted men's fashion e-commerce platform selling across India and worldwide (prices in INR; Razorpay, Shiprocket), designed to add women's fashion and other departments later.

**Status:** Phase 3 (checkout, payments, orders) built on 2026-10-15; the manual Razorpay test-key payment is still to do. Next is Phase 4, the admin portal.
**Plan date:** 2026-10-13. Library versions were checked against the npm registry on that date.
**Repository:** `github.com/aarvinexusai01/Duis-store` (branch `main`; CI on GitHub Actions)

## How to read this plan

Read in order. Each document stands alone, but later ones assume the decisions in earlier ones.

| # | Document | What it answers |
|---|---|---|
| 01 | [Requirements & decisions](01-requirements-and-decisions.md) | What we are building, what the business decided, and what we assume |
| 02 | [Architecture](02-architecture.md) | System shape, technology choices and why, caching, integrations, decision log |
| 03 | [Key flows & state machines](03-key-flows.md) | Checkout, payment, partial COD, inventory, shipping, exchanges, CMS publishing |
| 04 | [Folder structure](04-folder-structure.md) | Where every kind of code lives and the rules for each layer |
| 05 | [Database design](05-database-design.md) | Tables by domain, constraints, indexes, schema ownership |
| 06 | [Implementation phases](06-implementation-phases.md) | Phase-by-phase tasks, deliverables and exit criteria |
| 07 | [Deployment & operations](07-deployment-operations.md) | Docker, Compose, Caddy, Cloudflare, deploys, rollback, backups, monitoring |
| 08 | [Security & compliance](08-security-compliance.md) | Security controls and Indian legal requirements that shape the product |
| 09 | [Testing strategy](09-testing-strategy.md) | Test layers, the critical scenarios, and how they are verified |
| 10 | [Open questions & activation checklist](10-open-questions.md) | What still needs a decision and which external accounts are needed |
| — | [Permissions](permissions.md) | Roles and the generated role × operation matrix |

## The plan in one paragraph

We build a single Next.js 16 application, organised as a modular monolith with three interfaces: the storefront (`/`), the admin portal (`/admin`) and a custom CMS (`/admin/cms`). All three use one Better Auth login system and one role and permission model. All data lives in one self-hosted PostgreSQL 18 database, managed through Drizzle ORM migrations. A separate worker container runs reliable background jobs (pg-boss, which stores its queue in Postgres, so there is no Redis). Media files are kept on a persistent local volume and served by Caddy. Caddy sits behind Cloudflare and provides HTTPS. Customers pay fully online through Razorpay, or with partial COD: a small advance through Razorpay and the balance in cash on delivery. Shiprocket handles shipping and reverse pickups for exchanges. Everything runs on one Indian cloud VPS with Docker Compose, has encrypted off-site backups, and is deployed by building on the server.

## Conventions used in these documents

- **Must** marks a hard requirement. **Should** marks the default, which can be changed with a reason.
- Money is always stored and calculated in **integer paise** (₹1 = 100 paise).
- Items marked **⚠ Verify** must be re-checked against live documentation when implementation starts, because the vendor's API or behaviour may have changed.
- New architecture decisions made during implementation are added to the decision log in [02-architecture.md](02-architecture.md#decision-log) and, when substantial, as individual ADR files in `doc/adr/`.
