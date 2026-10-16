import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { notificationLogs } from "@/db/schema"
import { getDb } from "@/server/db/client"
import { deliverEmail } from "@/server/notifications/delivery"
import { queueEmail } from "@/server/notifications/email"
import { renderEmail } from "@/server/notifications/render"

import { unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"

closeConnectionsAfterAll()

const mailpit = process.env.MAILPIT_API_URL ?? "http://localhost:8025"

async function mailpitHasSubjectFor(to: string): Promise<boolean> {
  const query = encodeURIComponent(`to:"${to}"`)
  for (let attempt = 0; attempt < 20; attempt++) {
    const body = (await (
      await fetch(`${mailpit}/api/v1/search?query=${query}`)
    ).json()) as {
      messages: { Subject: string }[]
    }
    if (
      body.messages.some(
        (message) => message.Subject === "Confirm your email for Duis",
      )
    )
      return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

describe("email notifications", () => {
  it("escapes customer-supplied text in templates", () => {
    const rendered = renderEmail("verify-email", {
      name: "<script>alert(1)</script>",
      url: "https://duis.test/verify?token=abc",
    })
    expect(rendered.html).not.toContain("<script>")
    expect(rendered.html).toContain("&lt;script&gt;")
    expect(rendered.text).toContain("https://duis.test/verify?token=abc")
  })

  it("rejects bad template props when queueing", async () => {
    await expect(
      queueEmail({
        template: "verify-email",
        to: "a@duis.test",
        props: { name: "A", url: "javascript:x" },
      }),
    ).rejects.toThrow()
  })

  it("queues, delivers through SMTP and records the outcome", async () => {
    const to = `${unique("verify")}@duis.test`
    const notificationId = (await queueEmail({
      template: "verify-email",
      to,
      props: { name: "Asha", url: "https://duis.test/verify?token=abc" },
    }))!

    const job = await getDb().execute<{
      data: Parameters<typeof deliverEmail>[0]
    }>(
      sql`select data from pgboss.job where name = 'notify.email' and data->>'notificationId' = ${notificationId}`,
    )
    expect(job.rows).toHaveLength(1)

    // Run the worker's handler directly.
    await deliverEmail(job.rows[0]!.data)
    expect(await mailpitHasSubjectFor(to)).toBe(true)

    const [log] = await getDb()
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.id, notificationId))
    expect(log).toMatchObject({ status: "sent", provider: "smtp", attempts: 1 })
    expect(log!.recipient).not.toContain(to.split("@")[0])
  })
})
