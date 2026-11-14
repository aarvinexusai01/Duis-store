import "server-only"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import { staffPreferences } from "@/db/schema"
import type { Actor, UserActor } from "@/server/auth/actor"
import { isStaffActor } from "@/server/auth/actor"
import { rolesAllow, type PermissionRequest } from "@/server/auth/permissions"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * The admin helper (the corner cat): personal settings and a store-wide
 * getting-started checklist. Preferences are personal UI settings, not store
 * data, so changes are not written to the audit log (ADR-035).
 */

export type HelperPrefs = { hidden: boolean; tourDone: boolean }

export type ChecklistItem = {
  key: string
  label: string
  hint: string
  href: string
  done: boolean
}

export type HelperState = HelperPrefs & { checklist: ChecklistItem[] }

/** Each step, who may do it, and the SQL that says it's been done. */
const STEPS: {
  key: string
  label: string
  hint: string
  href: string
  permission: PermissionRequest
  doneSql: ReturnType<typeof sql>
}[] = [
  {
    key: "category",
    label: "Add a category",
    hint: "Categories are the shop's menu, like Men → T-shirts.",
    href: "/admin/categories",
    permission: { catalog: ["create"] },
    doneSql: sql`exists (select 1 from categories)`,
  },
  {
    key: "product",
    label: "Add a product",
    hint: "Give it a name, price and category, then save.",
    href: "/admin/products/new",
    permission: { catalog: ["create"] },
    doneSql: sql`exists (select 1 from products)`,
  },
  {
    key: "variants",
    label: "Generate colours and sizes",
    hint: "On the product, use Generate variants to make one per colour and size.",
    href: "/admin/products",
    permission: { catalog: ["create"] },
    doneSql: sql`exists (select 1 from product_variants)`,
  },
  {
    key: "stock",
    label: "Receive stock",
    hint: "In Inventory, press Adjust and choose 'Received new stock'.",
    href: "/admin/inventory",
    permission: { inventory: ["adjust"] },
    doneSql: sql`exists (select 1 from inventory_movements where reason = 'receive')`,
  },
  {
    key: "publish",
    label: "Publish a product",
    hint: "A product shows in the shop once it's published.",
    href: "/admin/products",
    permission: { catalog: ["publish"] },
    doneSql: sql`exists (select 1 from products where status = 'active')`,
  },
  {
    key: "discount",
    label: "Create a discount",
    hint: "A code or automatic offer, like 10% off a first order.",
    href: "/admin/discounts/new",
    permission: { discount: ["create"] },
    doneSql: sql`exists (select 1 from discounts)`,
  },
  {
    key: "media",
    label: "Upload a photo",
    hint: "Images in Media can be used on pages and stories.",
    href: "/admin/media",
    permission: { media: ["upload"] },
    doneSql: sql`exists (select 1 from media_assets)`,
  },
  {
    key: "story",
    label: "Write a journal story",
    hint: "Stories appear at /journal once they're published.",
    href: "/admin/cms/journal",
    permission: { cms: ["draft"] },
    doneSql: sql`exists (select 1 from blog_posts)`,
  },
]

function staffActor(actor: Actor): UserActor {
  if (!isStaffActor(actor)) {
    throw new DomainError("FORBIDDEN", "You do not have permission to do this.")
  }
  return actor
}

async function readPrefs(userId: string): Promise<HelperPrefs> {
  const [row] = await getDb()
    .select({
      hidden: staffPreferences.helperHidden,
      tourCompletedAt: staffPreferences.tourCompletedAt,
    })
    .from(staffPreferences)
    .where(eq(staffPreferences.userId, userId))
  return { hidden: row?.hidden ?? false, tourDone: !!row?.tourCompletedAt }
}

/** The steps this person can do, each marked done from store data. */
async function readChecklist(actor: UserActor): Promise<ChecklistItem[]> {
  const steps = STEPS.filter((step) => rolesAllow(actor.roles, step.permission))
  if (steps.length === 0) return []
  const columns = sql.join(
    steps.map((step) => sql`${step.doneSql} as ${sql.identifier(step.key)}`),
    sql`, `,
  )
  const result = await getDb().execute<Record<string, boolean>>(
    sql`select ${columns}`,
  )
  const row = result.rows[0] ?? {}
  return steps.map(({ key, label, hint, href }) => ({
    key,
    label,
    hint,
    href,
    done: row[key] === true,
  }))
}

export const getHelperState = defineOperation({
  name: "helper.getState",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<HelperState> {
    const staff = staffActor(actor)
    const [prefs, checklist] = await Promise.all([
      readPrefs(staff.userId),
      readChecklist(staff),
    ])
    return { ...prefs, checklist }
  },
})

export const updateHelperPrefs = defineOperation({
  name: "helper.updatePrefs",
  access: "authenticated",
  input: z
    .object({
      hidden: z.boolean().optional(),
      tourDone: z.literal(true).optional(),
    })
    .refine((v) => v.hidden !== undefined || v.tourDone, {
      message: "Nothing to change.",
    }),
  async handler({ actor }, input): Promise<HelperPrefs> {
    const staff = staffActor(actor)
    const set = {
      ...(input.hidden !== undefined && { helperHidden: input.hidden }),
      ...(input.tourDone && { tourCompletedAt: new Date() }),
    }
    await getDb()
      .insert(staffPreferences)
      .values({ userId: staff.userId, ...set })
      .onConflictDoUpdate({ target: staffPreferences.userId, set })
    return readPrefs(staff.userId)
  },
})
