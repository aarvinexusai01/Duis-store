import nodemailer from "nodemailer"
import { describe, expect, it } from "vitest"

const host = process.env.SMTP_HOST
const mailpitApi = process.env.MAILPIT_API_URL ?? "http://localhost:8025"

type MailpitSearch = { messages: { Subject: string }[] }

async function findBySubject(subject: string): Promise<boolean> {
  const query = encodeURIComponent(`subject:"${subject}"`)
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(`${mailpitApi}/api/v1/search?query=${query}`)
    const body = (await response.json()) as MailpitSearch
    if (body.messages.some((message) => message.Subject === subject)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

// Development and CI send to Mailpit; skipped when SMTP is not configured.
describe.skipIf(!host)("SMTP", () => {
  it("delivers a message to the configured server", async () => {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
    })
    const subject = `phase0-smtp-check-${Date.now()}`

    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: "smtp-check@duis.test",
      subject,
      text: "SMTP connectivity check",
    })

    await expect(findBySubject(subject)).resolves.toBe(true)
  })
})
