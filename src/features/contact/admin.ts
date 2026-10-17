import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import {
  CONTACT_STATUSES,
  type ContactStatus,
  type ContactTopic,
} from "./schemas"

export const MESSAGES_PAGE_SIZE = 50

export type ContactMessage = {
  id: string
  name: string
  email: string
  phone: string | null
  orderNumber: string | null
  topic: ContactTopic
  message: string
  status: ContactStatus
  note: string | null
  handledBy: string | null
  handledAt: Date | null
  createdAt: Date
}

type Row = {
  id: string
  name: string
  email: string
  phone: string | null
  order_number: string | null
  topic: ContactTopic
  message: string
  status: ContactStatus
  note: string | null
  handled_by_name: string | null
  handled_at: Date | null
  created_at: Date
}

const COLUMNS = sql`m.id, m.name, m.email, m.phone, m.order_number, m.topic, m.message,
  m.status, m.note, h.name as handled_by_name, m.handled_at, m.created_at`

function toMessage(r: Row): ContactMessage {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    orderNumber: r.order_number,
    topic: r.topic,
    message: r.message,
    status: r.status,
    note: r.note,
    handledBy: r.handled_by_name,
    handledAt: r.handled_at,
    createdAt: r.created_at,
  }
}

/** The inbox: newest first, by status ("open" = new). */
export const adminListMessages = defineOperation({
  name: "contact.adminList",
  access: { customer: ["read"] },
  input: z.object({
    status: z.enum([...CONTACT_STATUSES, "all"]).default("new"),
    q: z.string().trim().max(100).optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, input) {
    const like = input.q ? `%${input.q.replace(/[\\%_]/g, "\\$&")}%` : null
    const rows = await getDb().execute<Row & { total: number }>(sql`
      select ${COLUMNS}, count(*) over ()::int as total
      from contact_messages m left join users h on h.id = m.handled_by
      where (${input.status} = 'all' or m.status::text = ${input.status})
        and (${like}::text is null or m.email ilike ${like} or m.name ilike ${like}
             or m.order_number ilike ${like})
      order by m.created_at desc
      limit ${MESSAGES_PAGE_SIZE} offset ${(input.page - 1) * MESSAGES_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map(toMessage),
    }
  },
})

export const adminGetMessage = defineOperation({
  name: "contact.adminGet",
  access: { customer: ["read"] },
  input: z.object({ id: z.uuid() }),
  async handler(_ctx, input) {
    const found = await getDb().execute<
      Row & { order_exists: boolean; earlier: number }
    >(sql`
      select ${COLUMNS},
        exists (select 1 from orders o where o.order_number = m.order_number) as order_exists,
        (select count(*)::int from contact_messages e where e.email = m.email and e.id <> m.id) as earlier
      from contact_messages m left join users h on h.id = m.handled_by
      where m.id = ${input.id}`)
    const row = found.rows[0]
    if (!row) throw new DomainError("NOT_FOUND", "Message not found.")
    return {
      ...toMessage(row),
      orderExists: row.order_exists,
      otherMessages: row.earlier,
    }
  },
})

/** Mark a message replied or closed (or reopen it), with a staff-only note. */
export const updateContactMessage = defineOperation({
  name: "contact.update",
  access: { customer: ["update"] },
  input: z.object({
    id: z.uuid(),
    status: z.enum(CONTACT_STATUSES),
    note: z.string().trim().max(1000).optional(),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ was: ContactStatus }>(sql`
        update contact_messages m set status = ${input.status}::contact_message_status,
          note = case when ${input.note === undefined} then m.note else nullif(${input.note ?? ""}, '') end,
          handled_by = case when ${input.status} = 'new' then null else ${actor.kind === "user" ? actor.userId : null}::uuid end,
          handled_at = case when ${input.status} = 'new' then null else now() end,
          updated_at = now()
        from (select id, status as was from contact_messages where id = ${input.id} for update) old
        where m.id = old.id
        returning old.was`)
      const row = updated.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Message not found.")
      await writeAudit(tx, actor, {
        action: "contact_message.update",
        entityType: "contact_message",
        entityId: input.id,
        changes: {
          status: { from: row.was, to: input.status },
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      })
      return {}
    })
  },
})
