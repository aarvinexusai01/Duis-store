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

## Operations (Phase 4a, admin)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `catalog.adminGetProduct` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `catalog.adminListProducts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `catalog.adminListSizeCharts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `catalog.adminOptions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `catalog.duplicateProduct` | ✓ | ✓ | · | · | · | · | · |
| `catalog.updateAttributeValue` | ✓ | ✓ | · | · | · | · | · |
| `catalog.updateSizeChart` | ✓ | ✓ | · | · | · | · | · |
| `collections.adminGet` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `collections.adminList` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `collections.previewRules` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `inventory.adminListMovements` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `inventory.adminListStock` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `inventory.setCountedStock` | ✓ | ✓ | · | · | · | · | · |
| `reports.operationsSummary` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `reports.salesSummary` | ✓ | ✓ | · | · | · | · | · |

`/admin` returns 404 to anyone who isn't staff. Staff without 2FA are sent to `/admin/two-factor` first. The sidebar hides what a role can't use, but each operation still checks on the server.

## Operations (Phase 4b, orders, customers and discounts)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `customers.adminGet` | ✓ | ✓ | · | · | · | ✓ | · |
| `customers.adminList` | ✓ | ✓ | · | · | · | ✓ | · |
| `customers.setCodBlock` | ✓ | ✓ | · | · | · | ✓ | · |
| `discounts.adminGet` | ✓ | ✓ | · | · | · | · | · |
| `discounts.adminList` | ✓ | ✓ | · | · | · | · | · |
| `discounts.archive` | ✓ | ✓ | · | · | · | · | · |
| `discounts.generateCoupons` | ✓ | ✓ | · | · | · | · | · |
| `discounts.setActive` | ✓ | ✓ | · | · | · | · | · |
| `discounts.update` | ✓ | ✓ | · | · | · | · | · |
| `orders.addNote` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `orders.adminGet` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `orders.adminList` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `orders.cancelShipment` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.createShipments` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.getShipmentLabel` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.importCodRemittances` | ✓ | ✓ | · | · | · | · | · |
| `orders.listCodOutstanding` | ✓ | ✓ | · | · | · | · | · |
| `orders.refund` | ✓ | ✓ | · | · | · | · | · |
| `orders.retryShipment` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.simulateTracking` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.staffCancel` | ✓ | ✓ | · | · | · | ✓ | · |
| `orders.startProcessing` | ✓ | ✓ | · | · | ✓ | · | · |
| `orders.updateShippingAddress` | ✓ | ✓ | · | · | · | ✓ | · |

Amounts (order totals, payments, refunds and customer spend) are returned only to roles with `order: read_financials`. `orders.simulateTracking` also needs the fake courier outside production. Courier tracking webhooks are checked against the shared token, and processed as the system.

## Operations (Phase 4c, administration)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `audit.list` | ✓ | ✓ | · | · | · | · | · |
| `reports.cod` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportCod` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportCustomers` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportGst` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportInventory` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportOrders` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportProducts` | ✓ | ✓ | · | · | · | · | · |
| `reports.exportSales` | ✓ | ✓ | · | · | · | · | · |
| `reports.sales` | ✓ | ✓ | · | · | · | · | · |
| `settings.addTaxRule` | ✓ | ✓ | · | · | · | · | · |
| `settings.get` | ✓ | ✓ | · | · | · | · | · |
| `settings.integrationHealth` | ✓ | ✓ | · | · | · | · | · |
| `settings.testIntegration` | ✓ | ✓ | · | · | · | · | · |
| `settings.updateCod` | ✓ | ✓ | · | · | · | · | · |
| `settings.updateLegal` | ✓ | ✓ | · | · | · | · | · |
| `settings.updateNotifications` | ✓ | ✓ | · | · | · | · | · |
| `settings.updatePolicies` | ✓ | ✓ | · | · | · | · | · |
| `settings.updateShipping` | ✓ | ✓ | · | · | · | · | · |
| `staff.acceptInvitation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `staff.getInvitation` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `staff.invite` | ✓ | · | · | · | · | · | · |
| `staff.list` | ✓ | ✓ | · | · | · | · | · |
| `staff.resetTwoFactor` | ✓ | · | · | · | · | · | · |
| `staff.revokeInvitation` | ✓ | · | · | · | · | · | · |
| `staff.revokeSessions` | ✓ | · | · | · | · | · | · |
| `staff.search` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `staff.setActive` | ✓ | · | · | · | · | · | · |
| `staff.setRoles` | ✓ | · | · | · | · | · | · |
| `system.discardJob` | ✓ | · | · | · | · | · | · |
| `system.reprocessWebhook` | ✓ | · | · | · | · | · | · |
| `system.retryJob` | ✓ | · | · | · | · | · | · |
| `system.status` | ✓ | ✓ | · | · | · | · | · |

Notes on these operations:
- **Invitations:** `staff.getInvitation` and `staff.acceptInvitation` are public because the single-use token is the credential. Someone who already has an account must also be signed in as it.
- **Search:** `staff.search` needs only a signed-in user to call, but it refuses anyone who isn't staff, and it searches only what each role can read.
- **Staff safety:** there must always be another active Super Admin with 2FA. Nobody can deactivate themselves or reset their own 2FA.

## Operations (Phase 5a, exchanges and reviews)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `exchanges.adminGet` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `exchanges.adminList` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `exchanges.approve` | ✓ | ✓ | · | · | · | ✓ | · |
| `exchanges.cancel` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exchanges.failQc` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `exchanges.markReceived` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `exchanges.options` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exchanges.passQc` | ✓ | ✓ | · | · | ✓ | ✓ | · |
| `exchanges.reject` | ✓ | ✓ | · | · | · | ✓ | · |
| `exchanges.request` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `exchanges.startPayment` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `orders.tracking` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `photos.upload` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reviews.adminList` | ✓ | ✓ | · | · | · | ✓ | · |
| `reviews.moderate` | ✓ | ✓ | · | · | · | ✓ | · |
| `reviews.reviewable` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reviews.submit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

How the customer operations are limited:
- **Customer exchange and review operations** need a signed-in user, and each checks that the order is that person's own.
- **Tracking** (`orders.tracking`) is public; the signed token in the link is the credential.
- **Photos:** a customer photo is served only to its owner, to staff with exchange or review read access when it is attached to an exchange or review, and to everyone once its review is approved.

## Operations (Phase 5b, messaging and alerts)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `alerts.subscribe` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `customers.setWhatsAppUpdates` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `marketing.unsubscribe` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

How these are limited:
- **`alerts.subscribe`** is public, and rate-limited per IP in its Server Action.
- **`marketing.unsubscribe`** is public; the signed link is the credential.
- **`customers.setWhatsAppUpdates`** changes only the signed-in customer's own setting.
- **Login codes** are limited per phone and per IP before Better Auth sends them.

## Operations (Phase 5c, consent and contact)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `analytics.recordConsent` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contact.adminGet` | ✓ | ✓ | · | · | · | ✓ | · |
| `contact.adminList` | ✓ | ✓ | · | · | · | ✓ | · |
| `contact.send` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contact.update` | ✓ | ✓ | · | · | · | ✓ | · |

How these are limited:
- **`analytics.recordConsent`** is public (visitors answer before signing in), and rate-limited per IP in its Server Action.
- **`contact.send`** is public: a honeypot field, Turnstile once configured, 5 per IP per 10 minutes and 5 per address per hour.
- **The inbox** uses the customer permissions: reading needs `customer: read`, handling needs `customer: update`.

## Operations (Phase 6a–6b, CMS workflow)

Since 6b the workflow operations act on a target: a page, the header or footer menu, or the site settings.

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `cms.adminListPages` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `cms.archivePage` | ✓ | · | ✓ | · | · | · | · |
| `cms.autosaveDraft` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.cancelSchedule` | ✓ | · | ✓ | · | · | · | · |
| `cms.createPreviewLink` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `cms.getEditor` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `cms.listRevisions` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `cms.listScheduled` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `cms.publishDraft` | ✓ | · | ✓ | · | · | · | · |
| `cms.renamePage` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.requestChanges` | ✓ | · | ✓ | · | · | · | · |
| `cms.restorePage` | ✓ | · | ✓ | · | · | · | · |
| `cms.restoreRevision` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.schedule` | ✓ | · | ✓ | · | · | · | · |
| `cms.submitForReview` | ✓ | · | ✓ | ✓ | · | · | · |
| `cms.unpublishPage` | ✓ | · | ✓ | · | · | · | · |
| `cms.withdrawSubmission` | ✓ | · | ✓ | ✓ | · | · | · |
| `media.adminList` | ✓ | ✓ | ✓ | ✓ | · | · | · |

How these are limited:
- **Content Editors** create pages, edit drafts, submit for review and withdraw a submission. They can't publish, schedule, send back, unpublish or archive (ADR-0028).
- **Store Admins** can read every page, menu, setting and history, but not change content.
- **Preview links** are created by anyone who can read content, and work without signing in until they expire (24 hours). The signed token is the credential.
- **The `cms.publish-scheduled` job** publishes as the system, not as a person. Who scheduled it is in the audit log.

## Operations (Phase 6b, addresses, redirects and media)

| Operation | Super | Store | Content mgr | Editor | Fulfil | Support | Customer |
|---|---|---|---|---|---|---|---|
| `cms.changePageSlug` | ✓ | · | ✓ | · | · | · | · |
| `media.usage` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `redirects.adminList` | ✓ | ✓ | ✓ | ✓ | · | · | · |
| `redirects.create` | ✓ | · | ✓ | · | · | · | · |
| `redirects.delete` | ✓ | · | ✓ | · | · | · | · |

How these are limited:
- **Address changes and redirects** need `cms: publish` (Content Managers and Super Admins), because they change what live links do (ADR-0029).
- **Automatic redirects** are written by the operation that changes a product, collection or category address, under that operation's own permission.
- **"Where used"** is visible to anyone who can see the media library.
- **Deleting an image and archiving a collection** are refused while live or pending content uses them, whatever the role.

To regenerate after changing permissions, run `npx vitest run --project integration tests/integration/rbac.test.ts -u`, review the snapshot diff, and update this table.
