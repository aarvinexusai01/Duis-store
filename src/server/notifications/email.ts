import "server-only"

import { sql } from "drizzle-orm"

import { notificationLogs } from "@/db/schema"
import { maskEmail } from "@/lib/mask"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"

import {
  emailTemplates,
  OPTIONAL_EMAILS,
  type EmailTemplateName,
} from "./templates"

type QueueEmailInput = {
  template: EmailTemplateName
  to: string
  props: Record<string, unknown>
  userId?: string | null
  reference?: { type: string; id: string }
  // Replaces the settings' reply-to (e.g. the customer, on contact messages).
  replyTo?: string
}

/**
 * Records the email (masked) and queues its delivery. With `tx`, both happen
 * only if the surrounding business transaction commits. Optional emails that
 * staff turned off are skipped (null).
 */
export async function queueEmail(
  input: QueueEmailInput,
  options: { tx?: Transaction } = {},
): Promise<string | null> {
  // Fail fast on bad props instead of in the worker.
  emailTemplates[input.template].props.parse(input.props)

  const run = async (tx: Transaction) => {
    const setting =
      OPTIONAL_EMAILS[input.template as keyof typeof OPTIONAL_EMAILS]
    if (setting) {
      const enabled = await tx.execute<{ on: boolean }>(
        sql`select ${sql.identifier(setting)} as on from store_settings where id = 1`,
      )
      if (enabled.rows[0]?.on === false) return null
    }
    const [log] = await tx
      .insert(notificationLogs)
      .values({
        channel: "email",
        template: input.template,
        recipient: maskEmail(input.to),
        userId: input.userId ?? null,
        referenceType: input.reference?.type ?? null,
        referenceId: input.reference?.id ?? null,
      })
      .returning({ id: notificationLogs.id })

    await enqueue(
      QUEUES.notifyEmail,
      {
        notificationId: log!.id,
        template: input.template,
        to: input.to,
        props: input.props,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      },
      { tx },
    )
    return log!.id
  }

  return options.tx ? run(options.tx) : withTransaction(run)
}
