# 05 — Database Design

PostgreSQL 18. All application tables live in the `public` schema and are owned by **drizzle-kit migrations**. The column lists below are planning-level. Exact types and names are finalised in Phase 1 schema reviews.

## 1. Ownership and conventions

| Schema / objects | Owner | Migration mechanism |
|---|---|---|
| `public`: all app tables, including Better Auth tables | Us | drizzle-kit (`schemaFilter: ['public']`). Better Auth tables are generated with `npx @better-auth/cli generate` into `src/db/schema/auth.ts` and then migrated by drizzle-kit like any other table. |
| `pgboss` | pg-boss | pg-boss creates and upgrades its own schema at startup. drizzle-kit never touches it. |
| Extensions `pg_trgm`, `unaccent`, `ltree`, `citext` | DBA init script | `docker/postgres/initdb/02-extensions.sql` |

No two migration systems ever modify the same objects.

**Database roles (least privilege):**
- `duis_owner` owns the schema and runs migrations. It is never used by the running app.
- `duis_app` is used by web and worker. It has DML only, with `INSERT, SELECT` only on the append-only tables (`audit_logs`, `inventory_movements`, `wallet_ledger`, `order_status_history`, `webhook_events` processing columns excepted). Its `statement_timeout` is 15 s.
- `duis_readonly` is for reporting and backup verification.

**Column conventions:**
- `id uuid primary key default uuidv7()`
- `created_at` / `updated_at timestamptz not null default now()`
- Money as `*_paise integer` (or `bigint` for aggregates), with `CHECK (>= 0)` where it applies
- Statuses are Postgres enums or `text` with a CHECK, mirrored in TypeScript

**Snapshots:** orders copy every customer-visible detail (titles, variant labels, prices, address, tax), so editing a product later never changes past orders.

## 2. Identity and customers

| Table | Key columns / notes |
|---|---|
| `user` *(Better Auth)* | `email` (unique), `email_verified`, `name`, `image`, `phone_number` (unique), `phone_number_verified`, `role` (admin plugin; one or more of `super_admin, store_admin, content_manager, content_editor, fulfilment_staff, support_agent, customer`), `banned`, `ban_reason`, `ban_expires`, `two_factor_enabled` |
| `session`, `account`, `verification`, `two_factor`, `rate_limit` *(Better Auth)* | Sessions stored in the DB (revocable). `account` links the Google and credential providers. `rate_limit` uses database storage, which works across replicas. |
| `customer_profiles` | `user_id` (PK, FK), `marketing_email_consent_at`, `marketing_whatsapp_consent_at`, `cod_blocked` + reason, `deletion_requested_at` |
| `addresses` | `user_id`, `full_name`, `phone` (E.164), `line1`, `line2`, `landmark`, `city`, `region` (state/province), `state_code` (ISO 3166-2, required for India), `postal_code`, `country_code` (ISO 3166-1 alpha-2, default `IN`), `type` (home/work/other), `is_default`. CHECK: when `country_code = 'IN'`, `postal_code ~ '^[1-9][0-9]{5}$'` and `state_code` is set. Partial unique index on (`user_id`) where `is_default`. |

Roles and permissions are defined **in code** (Better Auth access control, ADR-003), so there are no `roles`, `permissions` or `user_roles` tables. Role changes are audited.

## 3. Catalog

| Table | Key columns / notes |
|---|---|
| `departments` | `slug` (unique: `men`, later `women`), `name`, `position`, `is_active`, SEO fields |
| `categories` | `department_id`, `parent_id` (self FK), `path ltree` (GiST index, for subtree queries), `slug` (unique per parent), `name`, `description`, `image_media_id`, `size_chart_id`, `default_hsn_code`, `exchange_allowed`, `position`, `is_active`, SEO fields (`seo_title`, `seo_description`, `og_media_id`, `noindex`) |
| `attributes` | `code` (unique: `color`, `size`, `fit`, `sleeve`, `neck`, `pattern`, `material`), `name`, `kind` (`swatch`, `text`), `is_variant_axis`, `is_filterable`, `position` |
| `attribute_values` | `attribute_id`, `slug`, `label`, `swatch_hex`, `filter_group` (for example Navy → `blue`), `position`. Unique (`attribute_id`, `slug`). |
| `size_charts` | `name`, `unit` (in/cm), `table jsonb` (Zod-validated rows and columns), `how_to_measure` (rich text) |
| `products` | `department_id`, `slug` (unique), `title`, `subtitle`, `description` (Tiptap JSON), `specifications jsonb` (validated key/value list), `material`, `care`, `hsn_code`, `country_of_origin`, `manufacturer_details`, `net_quantity`, `weight_grams`, `length_cm`/`breadth_cm`/`height_cm`, `status` (`draft`, `active`, `archived`), `published_at`, `tags text[]`, `search_vector tsvector` (generated, weighted), SEO fields. Indexes: GIN(`search_vector`), GIN trigram(`title`), (`status`, `published_at`). |
| `product_categories` | (`product_id`, `category_id`) PK, `is_primary`. Partial unique index: one primary per product. |
| `product_attributes` | (`product_id`, `attribute_id`) PK, `position`: which attributes act as variant axes for this product, and in what order |
| `product_attribute_values` | (`product_id`, `attribute_value_id`): non-axis descriptive attributes (fit, sleeve…) used for filters |
| `product_variants` | `product_id`, `sku` (unique, citext), `barcode`, `price_paise` (> 0), `mrp_paise` (MRP inclusive of taxes, `>= price_paise`), `status` (`active`, `inactive`), `position`, `weight_grams_override`, `option_signature` (for example `color=black;size=l`). **Unique (`product_id`, `option_signature`)** blocks duplicate combinations. |
| `variant_attribute_values` | (`variant_id`, `attribute_id`) PK, `attribute_value_id`. Index on (`attribute_value_id`, `variant_id`) for facet filtering. |
| `product_media` | `product_id`, `media_id`, `position`, `color_value_id` (nullable: images specific to a colour), `alt_override`. A variant shows its colour's images, falling back to the product's general images. |

**Listing performance:** `product_listing_cache` has one row per product: minimum and maximum price, best discount %, `in_stock`, `filter_value_ids` (every filterable value), `in_stock_value_ids` (axis values with stock now), `color_value_ids` (swatches in display order) and the primary/hover images, all GIN-indexed where filtered. The catalogue and inventory services rebuild a product's row in the same transaction as any change to its variants, prices, stock, attributes or media (`features/catalog/derived.ts`).

## 4. Inventory

| Table | Key columns / notes |
|---|---|
| `stock_locations` | `name`, `address`, `pincode`, `state_code`, `shiprocket_pickup_code`, `is_default` (exactly one) |
| `inventory_levels` | PK (`variant_id`, `location_id`), `on_hand`, `reserved`, `low_stock_threshold`, `updated_at`. **CHECK `on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand`.** |
| `inventory_reservations` | `variant_id`, `location_id`, `quantity`, `order_id` or `exchange_id`, `status` (`active`, `committed`, `released`, `expired`), `expires_at`. Index on (`status`, `expires_at`). |
| `inventory_movements` *(append-only)* | `variant_id`, `location_id`, `delta_on_hand`, `reason` (`receive`, `adjust`, `sale`, `cancel_restock`, `exchange_out`, `exchange_in`, `rto_restock`, `damaged`, `count_correction`), `reference_type`/`reference_id`, `note`, `actor_user_id`, `created_at` |

## 5. Collections

| Table | Key columns / notes |
|---|---|
| `collections` | `slug` (unique), `title`, `description`, `image_media_id`, `banner_media_id`, `type` (`manual`, `automatic`), `status` (`draft`, `published`, `archived`), `sort_mode` (`manual`, `best_selling`, `newest`, `price_asc`, `price_desc`), `published_at`, SEO fields |
| `collections.rules` | Rules are stored as JSONB on the collection (validated by `collectionRuleSchema`: `price` lte/gte, `category` subtree, `tag`, `created_within_days`, `attribute_value`, `best_selling`), combined with `rule_match` = `all` or `any` (ADR-0019). |
| `collection_products` | (`collection_id`, `product_id`) PK, `position`, `source` (`manual`, `rule`). Rule rows are rebuilt by the `catalog.refresh-auto-collections` job, so every listing uses the same query path. |
| `product_sales_stats` | `product_id`, `units_7d`, `units_30d`, `revenue_30d_paise`, `rank_best_selling`, `rank_trending`, `refreshed_at` |

## 6. Shopping

| Table | Key columns / notes |
|---|---|
| `carts` | `user_id` (nullable, unique while active), `anonymous_token_hash` (from a signed cookie), `status` (`active`, `merged`, `converted`), `coupon_code`, `last_activity_at`. Merged into the user's cart at login. |
| `cart_items` | `cart_id`, `variant_id`, `quantity` (1–10), `added_at`. Unique (`cart_id`, `variant_id`). |
| `wishlist_items` | (`user_id`, `product_id`) PK, `variant_id` (optional), `created_at` |

## 7. Orders, payments, wallet

| Table | Key columns / notes |
|---|---|
| `orders` | `order_number` (unique, from a sequence: `DUIS-100001`), `user_id`, `status`, `payment_status`, `fulfillment_status`, `payment_mode` (`prepaid`, `partial_cod`), `currency` (always `INR`, ADR-018), `destination_country`, `is_export` (true when shipping outside India), `subtotal_paise`, `discount_paise`, `shipping_fee_paise`, `cod_fee_paise`, `tax_total_paise`, `total_paise`, `wallet_applied_paise`, `online_amount_paise`, `cod_due_paise`, `cod_collected_at`, `coupon_code`, `shipping_address jsonb` (snapshot), `customer_email`, `customer_phone`, `place_idempotency_key` (unique), `placed_at`, `confirmed_at`, `cancelled_at`, `cancel_reason`, `reservation_expires_at`, `quote jsonb` (full pricing snapshot). Indexes: (`user_id`, `placed_at desc`), (`status`, `placed_at`). |
| `order_items` | `order_id`, `variant_id` (FK, `on delete set null`), `product_id`, `sku`, `title`, `variant_label`, `image_url`, `hsn_code`, `unit_price_paise`, `unit_mrp_paise`, `quantity`, `discount_paise`, `line_total_paise`, `tax_rate_bp`, `taxable_value_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `exchanged_quantity` |
| `order_discounts` | `order_id`, `discount_id`, `coupon_id`, `amount_paise`, `allocation jsonb` (amount per line) |
| `order_status_history` *(append-only)* | `order_id`, `field` (`status`, `payment_status`, `fulfillment_status`), `from`, `to`, `actor_user_id` / `system`, `reason`, `created_at` |
| `payments` | `order_id`, `purpose` (`full`, `advance`, `exchange_difference`), `provider`, `provider_order_id` (unique), `provider_payment_id` (unique, nullable), `amount_paise`, `currency`, `status` (`created`, `authorized`, `captured`, `failed`, `refunded`, `partially_refunded`), `method`, `error_code`, `error_reason`, `captured_at`, `raw jsonb` |
| `refunds` | `payment_id`, `order_id`, `amount_paise`, `reason`, `status` (`pending`, `processed`, `failed`), `provider_refund_id` (unique), `idempotency_key` (unique), `initiated_by`. Total refunded per payment ≤ captured amount, enforced in the service under a lock. |
| `cod_remittances` | `order_id`, `shipment_id`, `amount_paise`, `remitted_at`, `utr`, `source` (`api`, `csv`), `batch_ref` |
| `wallet_accounts` | `user_id` (PK), `balance_paise` (CHECK ≥ 0), `updated_at` |
| `wallet_ledger` *(append-only)* | `user_id`, `amount_paise` (signed), `reason` (`order_payment`, `order_reversal`, `cancellation_refund`, `exchange_credit`, `goodwill`, `rto_advance_credit`, `expiry`), `reference_type`/`reference_id`, `idempotency_key` (unique), `expires_at`, `created_by`, `note` |

## 8. Shipping and exchanges

| Table | Key columns / notes |
|---|---|
| `shipments` | `order_id`, `exchange_id` (nullable), `direction` (`forward`, `reverse`, `replacement`), `provider`, `provider_order_id`, `provider_shipment_id`, `awb` (unique, nullable), `courier_name`, `status` (normalised), `cod_amount_paise`, `label_file_key`, `pickup_scheduled_at`, `shipped_at`, `delivered_at`, `edd`, `weight_grams`, `last_synced_at`, `step_state jsonb` (resumable creation steps), `customs jsonb` (international only: HS codes, declared values, descriptions, country of origin, duties terms DDU/DDP) |
| `shipment_items` | `shipment_id`, `order_item_id`, `quantity` |
| `shipment_tracking_events` | `shipment_id`, `provider_status`, `status`, `location`, `occurred_at`, `raw jsonb`. Unique (`shipment_id`, `provider_status`, `occurred_at`). |
| `pincode_serviceability` | `pincode` (PK), `prepaid_available`, `cod_available`, `edd_min_days`, `edd_max_days`, `checked_at` (24-hour TTL) |
| `exchange_requests` | `exchange_number` (sequence), `order_id`, `order_item_id`, `quantity`, `requested_variant_id`, `reason`, `customer_note`, `status` (see the flows document), `price_difference_paise` (signed), `reverse_shipment_id`, `replacement_shipment_id`, `decided_by`, `decided_at`, `qc_note` |
| `exchange_request_media` | `exchange_request_id`, `media_id` (customer photos) |

## 9. Promotions

| Table | Key columns / notes |
|---|---|
| `discounts` | `name`, `kind` (`automatic`, `coupon`), `value_type` (`percentage`, `fixed`), `value` (basis points or paise), `max_discount_paise`, `min_order_paise`, `applies_to` (`all`, `targets`), `eligibility jsonb` (first order only, phone verified, allow-list of customers), `combinable` (bool), `priority`, `starts_at`, `ends_at`, `usage_limit_total`, `usage_limit_per_customer`, `status` |
| `discount_targets` | `discount_id`, `target_type` (`product`, `variant`, `category`, `collection`), `target_id` |
| `coupons` | `discount_id`, `code` (citext, unique), `times_used` (updated under a row lock at redemption) |
| `coupon_redemptions` | `coupon_id`, `order_id` (unique), `user_id`, `amount_paise`, `status` (`active`, `reversed`). Index on (`coupon_id`, `user_id`). |

## 10. Reviews and marketing

| Table | Key columns / notes |
|---|---|
| `product_reviews` | `product_id`, `order_item_id` (unique: one review per purchased line), `user_id`, `rating` (CHECK 1–5), `title`, `body`, `fit_feedback` (`runs_small`, `true_to_size`, `runs_large`), `status` (`pending`, `approved`, `rejected`), `moderated_by`, `published_at` |
| `review_media` | `review_id`, `media_id` |
| `product_rating_stats` | `product_id` (PK), `average`, `count`, `distribution jsonb` |
| `stock_alert_subscriptions` | `user_id`, `variant_id`, `channel` (`email`, `whatsapp`), `status` (`active`, `notified`, `cancelled`). Partial unique index on (`user_id`, `variant_id`) where active. |
| `cart_reminders` | `cart_id`, `sequence_no`, `channel`, `sent_at`. Unique (`cart_id`, `sequence_no`). |
| `newsletter_subscribers` | `email` (citext, unique), `status` (`pending`, `confirmed`, `unsubscribed`), `confirm_token_hash`, `consent_at`, `source` |
| `contact_messages` | `name`, `email`, `phone`, `subject`, `message`, `status` (`new`, `handled`), `handled_by` |

## 11. CMS

| Table | Key columns / notes |
|---|---|
| `media_assets` | `storage_key` (unique), `kind` (`image`), `mime`, `bytes`, `width`, `height`, `sha256` (unique, for deduplication), `renditions jsonb` (width → key), `alt_text`, `caption`, `focal_x`, `focal_y`, `uploaded_by`, `deleted_at` |
| `cms_pages` | `type` (`home`, `landing`, `static`, `policy`), `slug` (unique), `title`, `status`, `draft_revision_id`, `published_revision_id`, `published_at`. Scheduling (Phase 6) uses `cms_revisions.scheduled_for`. |
| `cms_revisions` | `entity_type` (`page`, `blog_post`, `navigation`, `site_settings`), `entity_id`, `version` (unique per entity), `data jsonb` (Zod-validated: blocks, SEO, body), `workflow_status` (`draft`, `in_review`, `approved`, `scheduled`, `published`, `archived`), `created_by`, `reviewed_by`, `published_by`, `published_at`, `note` |
| `cms_revision_refs` | `revision_id` plus **one nullable FK column per target**: `product_id`, `collection_id`, `category_id`, `media_id`, `blog_post_id`. CHECK that exactly one is set. FKs use `ON DELETE RESTRICT`, so a referenced item can be archived but not hard-deleted while it is in use. |
| `blog_posts` | `slug` (unique), `title`, `excerpt`, `cover_media_id`, `author_id`, `category_id`, `draft_revision_id`, `published_revision_id`, `scheduled_at`, `published_at`, `status` |
| `blog_authors` · `blog_categories` · `blog_tags` · `blog_post_tags` | Standard blog taxonomy. Authors are optionally linked to a `user`. |
| `navigation_menus` | `key` (unique: `header`, `footer`, `mobile`, `social`), `draft_revision_id`, `published_revision_id`. Items (label, link type and target, badge, promo image, children) are stored in the revision data and their targets indexed in `cms_revision_refs`. |
| `site_settings` | Singleton row (`id = 1`, CHECK) with an `entity_id` for its revisions and `draft_revision_id` / `published_revision_id`: brand name, logo, contact details, social links, announcement bar, default SEO, grievance officer details |
| `redirects` | `from_path` (unique), `to_path`, `status_code` (301, 302), `hits`, `created_by` |

**Commerce settings** (free-shipping threshold, flat fee, partial-COD rules, exchange window, GSTIN and warehouse state) live in `store_settings` and `tax_rules`. These belong to the admin portal, not the CMS:

| Table | Key columns / notes |
|---|---|
| `store_settings` | Singleton, versioned: `free_shipping_threshold_paise`, `flat_shipping_fee_paise`, `partial_cod_enabled`, `cod_advance_type` / `cod_advance_value`, `cod_max_order_paise`, `cod_fee_paise`, `exchange_window_days`, `max_exchanges_per_item`, `reservation_ttl_minutes`, `gstin`, `legal_name`, `registered_state_code`, `rto_advance_policy`, `iec_code` and `lut_reference` (exports, ADR-018), `blocked_country_codes` |
| `tax_rules` | `hsn_prefix`, `price_threshold_paise`, `rate_below_bp`, `rate_above_bp`, `effective_from`, `effective_to` |

## 12. Operations

| Table | Key columns / notes |
|---|---|
| `audit_logs` *(append-only)* | `actor_user_id`, `actor_roles`, `action` (for example `product.update`), `entity_type`, `entity_id`, `changes jsonb` (before/after diff, secrets redacted), `ip`, `user_agent`, `request_id`, `created_at`. Index on (`entity_type`, `entity_id`, `created_at`). |
| `webhook_events` | `provider`, `event_id`, `event_type`, `payload jsonb`, `received_at`, `processed_at`, `status`, `attempts`, `last_error`. **Unique (`provider`, `event_id`).** |
| `idempotency_keys` | `key` (PK), `scope`, `request_hash`, `response jsonb`, `expires_at` |
| `notification_logs` | `user_id`, `channel`, `template`, `recipient` (masked), `status` (`queued`, `sent`, `failed`), `provider_message_id`, `error`, `reference_type`/`reference_id`, `sent_at` |
| `consent_records` | `user_id` or `anonymous_id`, `purpose` (`analytics`, `marketing`), `granted`, `policy_version`, `ip_hash`, `created_at` (DPDP evidence) |
| `export_files` | `type` (`gst`, `sales`, `cod`), `params jsonb`, `status`, `file_key` (private storage), `created_by`, `expires_at` |

## 13. Migration workflow

1. Edit `src/db/schema/*.ts`, then run `npm run db:generate` (`drizzle-kit generate`).
2. Review the generated SQL in the pull request (`src/db/migrations/`). Hand-edit it only for data migrations, triggers and generated columns, which are kept as reviewed SQL.
3. Locally: `npm run db:migrate`. In production, `deploy.sh` runs the `migrate` container as `duis_owner` before the web replicas restart.
4. **Expand/contract:** while the replicas roll over, the old and new app versions run side by side. Every migration must therefore be backward compatible: add columns as nullable or with defaults, backfill, switch reads, and drop only in a later release.
5. `drizzle-kit push` is **never** used against shared or production databases.
