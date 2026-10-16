import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { citext, primaryId, timestamps, timestamptz } from "./columns"

export const discountKind = pgEnum("discount_kind", ["automatic", "coupon"])
export const discountValueType = pgEnum("discount_value_type", [
  "percentage",
  "fixed",
])
export const discountAppliesTo = pgEnum("discount_applies_to", [
  "all",
  "targets",
])
export const discountStatus = pgEnum("discount_status", [
  "active",
  "paused",
  "archived",
])
export const discountTargetType = pgEnum("discount_target_type", [
  "product",
  "variant",
  "category",
  "collection",
])

export type DiscountEligibility = {
  firstOrderOnly?: boolean
  phoneVerifiedOnly?: boolean
  userIds?: string[]
}

/** Automatic promotions and coupon definitions (doc/05 §9). */
export const discounts = pgTable(
  "discounts",
  {
    id: primaryId(),
    name: text().notNull(),
    kind: discountKind().notNull(),
    valueType: discountValueType().notNull(),
    // Basis points for percentages, paise for fixed amounts.
    value: integer().notNull(),
    maxDiscountPaise: integer(),
    minOrderPaise: integer().notNull().default(0),
    appliesTo: discountAppliesTo().notNull().default("all"),
    eligibility: jsonb().$type<DiscountEligibility>().notNull().default({}),
    // Whether a coupon may stack on lines that already have a sale price.
    combinable: boolean().notNull().default(false),
    priority: integer().notNull().default(0),
    startsAt: timestamptz().notNull().defaultNow(),
    endsAt: timestamptz(),
    usageLimitTotal: integer(),
    usageLimitPerCustomer: integer(),
    status: discountStatus().notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    index("discounts_active_idx").on(t.kind, t.status, t.startsAt),
    check(
      "discounts_value_check",
      sql`${t.value} > 0 and (${t.valueType} <> 'percentage' or ${t.value} <= 10000)`,
    ),
    check(
      "discounts_window_check",
      sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
)

export const discountTargets = pgTable(
  "discount_targets",
  {
    discountId: uuid()
      .notNull()
      .references(() => discounts.id, { onDelete: "cascade" }),
    targetType: discountTargetType().notNull(),
    targetId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.discountId, t.targetType, t.targetId] }),
    index("discount_targets_target_idx").on(t.targetType, t.targetId),
  ],
)

export const coupons = pgTable(
  "coupons",
  {
    id: primaryId(),
    discountId: uuid()
      .notNull()
      .references(() => discounts.id, { onDelete: "cascade" }),
    code: citext().notNull().unique(),
    // Changed only under a row lock at redemption (doc/03 §1.3).
    timesUsed: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check("coupons_code_check", sql`${t.code} ~ '^[A-Za-z0-9_-]{3,32}$'`),
    check("coupons_times_used_check", sql`${t.timesUsed} >= 0`),
  ],
)
