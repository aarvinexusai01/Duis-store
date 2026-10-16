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

## Operations (Phase 1, staff)

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

## Operations (Phase 2, storefront)

None of these is a staff permission, so the role makes no difference: every role column matches the "Customer" column.

| Operation | Access | Scope |
|---|---|---|
| `cart.get`, `cart.addItem`, `cart.updateItem` | Public | The caller's own cart: the account's when signed in, otherwise the one matching the hashed guest-cookie token |
| `cart.mergeGuest` | Signed in | Moves the caller's guest cart into their own account |
| `customers.getOverview`, `customers.updateProfile` | Signed in | Own account only |
| `customers.setMarketingConsent`, `customers.setDeletionRequest` | Signed in | Own account only |
| `customers.listAddresses`, `customers.saveAddress`, `customers.deleteAddress` | Signed in | Own addresses only (another customer's id answers `NOT_FOUND`) |
| `wishlist.add`, `wishlist.remove`, `wishlist.list` | Signed in | Own wishlist only |
| `marketing.subscribeNewsletter`, `marketing.confirmNewsletter` | Public | Same response for every address; confirmation needs the emailed token |
| `shipping.checkServiceability` | Public | Rate limited at `/api/serviceability` |

Ownership is enforced inside each operation (by the actor's user id), and integration tests in `tests/integration/storefront-customer.test.ts` cover it.

## Operations (Phase 3, checkout and orders)

| Operation | Access | Scope |
|---|---|---|
| `checkout.quote`, `checkout.placeOrder` | Signed in | Own bag and own saved addresses; amounts always recomputed on the server |
| `checkout.startPayment`, `checkout.verifyPayment` | Signed in | Own orders; the payment must belong to the order and pass the gateway signature and server-side fetch |
| `checkout.simulatePayment` | Signed in | Own orders, and refused unless `PAYMENT_PROVIDER=fake` outside production |
| `orders.listMine`, `orders.getMine`, `orders.cancel` | Signed in | Own orders; cancellation only before dispatch |
| `wallet.getSummary` | Signed in | Own wallet |
| `discounts.create` | `discount: create` | Super Admin, Store Admin |
| `wallet.grantGoodwill` | `customer: credit` | Super Admin, Store Admin (promotional credit that expires) |

Payment settlement, expiry, reconciliation and refunds run as the system (jobs and the verified webhook), never on a customer's behalf.

To regenerate after changing permissions, run `npx vitest run --project integration tests/integration/rbac.test.ts -u`, review the snapshot diff, and update this table.
