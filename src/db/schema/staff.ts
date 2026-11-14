import { sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core"

import { users } from "./auth"
import { citext, primaryId, timestamptz } from "./columns"

/**
 * Staff invitations (owner decision 2026-10-16): a single-use link, valid for
 * 72 hours. Only a hash of the token is stored.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: primaryId(),
    email: citext().notNull(),
    roles: text().array().notNull(),
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    acceptedUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index("staff_invitations_email_idx").on(t.email, t.createdAt),
    check(
      "staff_invitations_roles_check",
      sql`cardinality(${t.roles}) > 0 and not ('customer' = any(${t.roles}))`,
    ),
  ],
)

/**
 * Per-person admin helper settings (the corner cat): whether it is hidden and
 * whether the first-visit tour is done. One row per staff member, created on
 * first change; a missing row means the defaults.
 */
export const staffPreferences = pgTable("staff_preferences", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  helperHidden: boolean().notNull().default(false),
  tourCompletedAt: timestamptz(),
  updatedAt: timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})
