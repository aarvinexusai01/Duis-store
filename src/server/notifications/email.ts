import "server-only"

import { notificationLogs } from "@/db/schema"
import { maskEmail } from "@/lib/mask"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"

import { emailTemplates, type EmailTemplateName } from "./templates"

type QueueEmailInput = {
  template: EmailTemplateName
  to: string
  props: Record<string, unknown>
  userId?: string | null
  reference?: { type: string; id: string }
}

/**
 * Records the email (masked) and queues its delivery. With `tx`, both happen
 * only if the surrounding business transaction commits.
 */
export async function queueEmail(
  input: QueueEmailInput,
  options: { tx?: Transaction } = {},
): Promise<string> {
  // Fail fast on bad props instead of in the worker.
  emailTemplates[input.template].props.parse(input.props)

  const run = async (tx: Transaction) => {
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
      },
      { tx },
    )
    return log!.id
  }

  return options.tx ? run(options.tx) : withTransaction(run)
}
