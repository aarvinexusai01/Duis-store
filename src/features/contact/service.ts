import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

import { CONTACT_TOPICS, contactMessageSchema } from "./schemas"

/** Per address: enough for a conversation, not for flooding the inbox. */
const PER_EMAIL_PER_HOUR = 5

export function adminMessageUrl(id: string): string {
  return new URL(`/admin/messages/${id}`, getServerEnv().APP_URL).toString()
}

/**
 * The contact form (owner decision 2026-10-16): saved to the admin inbox and
 * emailed to the support address with reply-to set to the customer. No
 * acknowledgement goes to the address given, so the form can't be used to
 * send our mail to strangers.
 */
export const sendContactMessage = defineOperation({
  name: "contact.send",
  access: "public",
  input: contactMessageSchema,
  async handler({ actor, log }, input): Promise<{ id: string }> {
    return withTransaction(async (tx) => {
      const recent = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from contact_messages
        where email = ${input.email} and created_at > now() - interval '1 hour'`)
      if ((recent.rows[0]?.n ?? 0) >= PER_EMAIL_PER_HOUR) {
        throw new DomainError(
          "RATE_LIMITED",
          "You've sent several messages already. We'll reply soon.",
        )
      }
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into contact_messages (name, email, phone, order_number, topic, message, user_id)
        values (${input.name}, ${input.email}, ${input.phone ?? null}, ${input.orderNumber ?? null},
                ${input.topic}, ${input.message}, ${actor.kind === "user" ? actor.userId : null})
        returning id`)
      const id = inserted.rows[0]!.id
      const settings = await tx.execute<{ to: string | null }>(sql`
        select coalesce(support_email, email_reply_to) as to from store_settings where id = 1`)
      const to = settings.rows[0]?.to
      if (!to) {
        log.warn("no support address set: contact message is in the inbox only")
        return { id }
      }
      await queueEmail(
        {
          template: "contact-message",
          to,
          replyTo: input.email,
          reference: { type: "contact_message", id },
          props: {
            name: input.name,
            email: input.email,
            ...(input.phone ? { phone: input.phone } : {}),
            ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
            topic: CONTACT_TOPICS[input.topic],
            message: input.message,
            url: adminMessageUrl(id),
          },
        },
        { tx },
      )
      return { id }
    })
  },
})
