import "server-only"
import { eq, sql } from "drizzle-orm"
import nodemailer, { type Transporter } from "nodemailer"

import { getServerEnv } from "@/config/env"
import { notificationLogs } from "@/db/schema"
import { getDb } from "@/server/db/client"
import type { JobPayloads } from "@/server/jobs/queues"

import { renderEmail } from "./render"

/** Worker-only email delivery (it imports the renderer). */

const globalForMail = globalThis as typeof globalThis & {
  __duisMailer?: Transporter
}

function getMailer(): Transporter {
  if (!globalForMail.__duisMailer) {
    const env = getServerEnv()
    globalForMail.__duisMailer = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
      pool: true,
      maxConnections: 3,
    })
  }
  return globalForMail.__duisMailer
}

/**
 * The sender name and reply-to from the admin settings. The address itself
 * stays SMTP_FROM's, because the mail server is authorised for it.
 */
async function senderFor(smtpFrom: string): Promise<{
  from: string | { name: string; address: string }
  replyTo: string | null
}> {
  const address = /<([^>]+)>/.exec(smtpFrom)?.[1] ?? smtpFrom
  const settings = await getDb().execute<{
    email_sender_name: string
    email_reply_to: string | null
  }>(
    sql`select email_sender_name, email_reply_to from store_settings where id = 1`,
  )
  const row = settings.rows[0]
  if (!row) return { from: smtpFrom, replyTo: null }
  return {
    from: { name: row.email_sender_name, address },
    replyTo: row.email_reply_to,
  }
}

/** notify.email handler: render, send, record the outcome. */
export async function deliverEmail(
  payload: JobPayloads["notify.email"],
): Promise<void> {
  const db = getDb()
  const rendered = renderEmail(payload.template, payload.props)
  const sender = await senderFor(getServerEnv().SMTP_FROM)

  try {
    const info = await getMailer().sendMail({
      from: sender.from,
      ...((payload.replyTo ?? sender.replyTo)
        ? { replyTo: payload.replyTo ?? sender.replyTo! }
        : {}),
      to: payload.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    await db
      .update(notificationLogs)
      .set({
        status: "sent",
        provider: "smtp",
        providerMessageId: info.messageId ?? null,
        attempts: sql`${notificationLogs.attempts} + 1`,
        error: null,
        sentAt: new Date(),
      })
      .where(eq(notificationLogs.id, payload.notificationId))
  } catch (err) {
    await db
      .update(notificationLogs)
      .set({
        attempts: sql`${notificationLogs.attempts} + 1`,
        error: (err as Error).message.slice(0, 500),
      })
      .where(eq(notificationLogs.id, payload.notificationId))
    throw err
  }
}

/** Called when a notify.email job lands in the dead-letter queue. */
export async function markEmailFailed(notificationId: string): Promise<void> {
  await getDb()
    .update(notificationLogs)
    .set({ status: "failed" })
    .where(eq(notificationLogs.id, notificationId))
}
