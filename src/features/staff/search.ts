import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { rolesAllow } from "@/server/auth/permissions"
import { isStaff } from "@/server/auth/roles"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * The admin command palette (Ctrl/⌘+K): orders, products, customers and
 * discounts matching the text, each group only for roles that can read it.
 */
export type SearchHit = {
  group: string
  label: string
  detail: string
  href: string
}

export const adminSearch = defineOperation({
  name: "staff.search",
  access: "authenticated",
  input: z.object({ q: z.string().trim().min(2).max(100) }),
  async handler({ actor }, { q }): Promise<SearchHit[]> {
    if (actor.kind !== "user" || !isStaff(actor.roles)) {
      throw new DomainError("FORBIDDEN", "Staff only.")
    }
    const can = (request: Parameters<typeof rolesAllow>[1]) =>
      rolesAllow(actor.roles, request)
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`
    const db = getDb()
    const [orders, products, customers, discounts] = await Promise.all([
      can({ order: ["read"] })
        ? db.execute<{
            order_number: string
            customer_name: string
            status: string
          }>(sql`
            select o.order_number, o.customer_name, o.status from orders o
            where o.status <> 'expired' and (o.order_number ilike ${like} or o.customer_name ilike ${like}
              or o.customer_phone ilike ${like}
              or exists (select 1 from shipments s where s.order_id = o.id and s.awb ilike ${like}))
            order by o.placed_at desc limit 5`)
        : null,
      can({ catalog: ["read"] })
        ? db.execute<{ id: string; title: string; status: string }>(sql`
            select p.id, p.title, p.status from products p
            where p.title ilike ${like}
              or exists (select 1 from product_variants v where v.product_id = p.id and v.sku::text ilike ${like})
            order by p.updated_at desc limit 5`)
        : null,
      can({ customer: ["read"] })
        ? db.execute<{ id: string; name: string; email: string }>(sql`
            select u.id, u.name, u.email from users u
            where (u.role is null or u.role = 'customer')
              and (u.name ilike ${like} or u.email ilike ${like} or u.phone_number ilike ${like})
            order by u.created_at desc limit 5`)
        : null,
      can({ discount: ["read"] })
        ? db.execute<{ id: string; name: string }>(sql`
            select d.id, d.name from discounts d
            where d.name ilike ${like} or exists (select 1 from coupons c where c.discount_id = d.id and c.code::text ilike ${like})
            order by d.created_at desc limit 5`)
        : null,
    ])
    return [
      ...(orders?.rows ?? []).map((o) => ({
        group: "Orders",
        label: o.order_number,
        detail: `${o.customer_name} · ${o.status.replace(/_/g, " ")}`,
        href: `/admin/orders/${o.order_number}`,
      })),
      ...(products?.rows ?? []).map((p) => ({
        group: "Products",
        label: p.title,
        detail: p.status,
        href: `/admin/products/${p.id}`,
      })),
      ...(customers?.rows ?? []).map((c) => ({
        group: "Customers",
        label: c.name,
        detail: c.email.endsWith(".invalid") ? "Phone sign-in" : c.email,
        href: `/admin/customers/${c.id}`,
      })),
      ...(discounts?.rows ?? []).map((d) => ({
        group: "Discounts",
        label: d.name,
        detail: "Discount",
        href: `/admin/discounts/${d.id}`,
      })),
    ]
  },
})
