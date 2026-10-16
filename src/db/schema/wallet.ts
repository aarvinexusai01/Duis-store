import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { users } from "./auth"
import { primaryId, timestamptz } from "./columns"

export const walletReason = pgEnum("wallet_reason", [
  "order_payment",
  "order_reversal",
  "cancellation_refund",
  "exchange_credit",
  "goodwill",
  "rto_advance_credit",
  "expiry",
  "adjustment",
])

/** The balance cache; the ledger is the source of truth. */
export const walletAccounts = pgTable(
  "wallet_accounts",
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    balancePaise: integer().notNull().default(0),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [check("wallet_accounts_balance_check", sql`${t.balancePaise} >= 0`)],
)

/** Append-only (UPDATE/DELETE revoked). Credits are positive, debits negative. */
export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountPaise: integer().notNull(),
    reason: walletReason().notNull(),
    referenceType: text(),
    referenceId: uuid(),
    idempotencyKey: text().notNull().unique(),
    // Set on promotional credits only (doc/10 P12).
    expiresAt: timestamptz(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    note: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("wallet_ledger_user_idx").on(t.userId, t.createdAt),
    check("wallet_ledger_amount_check", sql`${t.amountPaise} <> 0`),
  ],
)

/**
 * What is left of each credit. Debits spend the soonest-expiring lot first;
 * reversing a debit puts the money back into the lots it came from, so
 * promotional credit keeps its original expiry.
 */
export const walletCreditLots = pgTable(
  "wallet_credit_lots",
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ledgerId: uuid()
      .notNull()
      .unique()
      .references(() => walletLedger.id, { onDelete: "restrict" }),
    amountPaise: integer().notNull(),
    remainingPaise: integer().notNull(),
    expiresAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("wallet_credit_lots_open_idx")
      .on(t.userId, t.expiresAt)
      .where(sql`${t.remainingPaise} > 0`),
    check(
      "wallet_credit_lots_remaining_check",
      sql`${t.amountPaise} > 0 and ${t.remainingPaise} between 0 and ${t.amountPaise}`,
    ),
  ],
)

export const walletLotUsages = pgTable(
  "wallet_lot_usages",
  {
    debitLedgerId: uuid()
      .notNull()
      .references(() => walletLedger.id, { onDelete: "restrict" }),
    lotId: uuid()
      .notNull()
      .references(() => walletCreditLots.id, { onDelete: "restrict" }),
    amountPaise: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.debitLedgerId, t.lotId] }),
    check("wallet_lot_usages_amount_check", sql`${t.amountPaise} > 0`),
  ],
)
