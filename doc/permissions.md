# Permissions

Who can do what, as enforced in code. Roles and their permissions are defined in [`src/server/auth/permissions.ts`](../src/server/auth/permissions.ts) (ADR-003). Every service operation declares what it needs, and [`tests/integration/rbac.test.ts`](../tests/integration/rbac.test.ts) calls **every operation with every role** to confirm the right people are allowed or refused. The table below is generated from that test's snapshot, so a permission change shows up in code review.

## Roles

| Role | For | Notes |
|---|---|---|
| Super Admin | The owner | Everything, including staff management. No role can impersonate users. |
| Store Admin | Day-to-day operations | Catalogue, stock, collections, orders, discounts, customers, settings, reports. Read-only CMS. |
| Content Manager | Website content | Create, review and **publish** CMS content. Manage media. Read-only catalogue. |
| Content Editor | Writing content | Draft CMS content and upload images. **Cannot publish.** |
| Fulfilment Staff | Packing and shipping | Orders (without revenue figures) and exchange processing. Read-only stock. |
| Support Agent | Customer service | Orders, cancellations, exchange decisions, customer details, review moderation. |
| Customer | Shoppers | Their own account, cart and orders only (checked by ownership, not by role). |

Every staff role must have **two-factor authentication** enabled before any staff permission applies. Order, exchange, discount and customer operations arrive in Phases 3–5; the role definitions above already include them.

## Operations (Phase 1)

✓ allowed · refused. "Customer" also stands for anyone signed in; public operations need no account.

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `catalog.archiveProduct` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createAttribute` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createAttributeValue` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createCategory` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createDepartment` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createProduct` | ✓ | ✓ | · | · | · | · | · |
| `catalog.createSizeChart` | ✓ | ✓ | · | · | · | · | · |
| `catalog.generateVariants` | ✓ | ✓ | · | · | · | · | · |
| `catalog.moveCategory` | ✓ | ✓ | · | · | · | · | · |
| `catalog.publishProduct` | ✓ | ✓ | · | · | · | · | · |
| `catalog.setProductMedia` | ✓ | ✓ | · | · | · | · | · |
| `catalog.updateCategory` | ✓ | ✓ | · | · | · | · | · |
| `catalog.updateProduct` | ✓ | ✓ | · | · | · | · | · |
| `catalog.updateVariant` | ✓ | ✓ | · | · | · | · | · |
| `cms.createPage` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.publishRevision` | ✓ | · | ✓ | · | · | · | · |
| `cms.saveNavigationDraft` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.savePageDraft` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.saveSiteSettingsDraft` | ✓ | · | ✓ | ✓ | · | · | · |
| `collections.archiveCollection` | ✓ | ✓ | · | · | · | · | · |
| `collections.createCollection` | ✓ | ✓ | · | · | · | · | · |
| `collections.publishCollection` | ✓ | ✓ | · | · | · | · | · |
| `collections.setCollectionProducts` | ✓ | ✓ | · | · | · | · | · |
| `collections.updateCollection` | ✓ | ✓ | · | · | · | · | · |
| `inventory.adjustStock` | ✓ | ✓ | · | · | · | · | · |
| `inventory.createStockLocation` | ✓ | ✓ | · | · | · | · | · |
| `inventory.getAvailability` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory.setLowStockThreshold` | ✓ | ✓ | · | · | · | · | · |
| `media.deleteMedia` | ✓ | ✓ | ✓ | · | · | · | · |
| `media.updateMediaDetails` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `media.uploadImage` | ✓ | ✓ | ✓ | ✓ | · | · | · |

`inventory.getAvailability` is public: live stock is shown on product pages.

To regenerate after changing permissions, run `npx vitest run --project integration tests/integration/rbac.test.ts -u`, review the snapshot diff, and update this table.
