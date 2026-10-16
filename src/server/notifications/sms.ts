import "server-only"

import { getServerEnv } from "@/config/env"
import { notificationLogs } from "@/db/schema"
import { maskPhone } from "@/lib/mask"
import { getDb } from "@/server/db/client"
import { logger } from "@/server/observability/logger"

type SentSms = { to: string; code: string; sentAt: Date }

interface SmsProvider {
  readonly name: string
  sendOtp(to: string, code: string): Promise<{ providerMessageId: string }>
}

const globalForSms = globalThis as typeof globalThis & {
  __duisFakeSms?: SentSms[]
}

/**
 * Development and test provider. It never sends anything: codes are kept in
 * memory (for tests) and printed to the local log so a developer can sign in.
 * The environment check forbids it in production.
 */
const fakeProvider: SmsProvider = {
  name: "fake",
  async sendOtp(to, code) {
    const outbox = (globalForSms.__duisFakeSms ??= [])
    outbox.push({ to, code, sentAt: new Date() })
    if (outbox.length > 50) outbox.shift()
    logger.info(
      { to: maskPhone(to), code },
      "fake SMS provider: OTP not sent (development only)",
    )
    return { providerMessageId: `fake-${crypto.randomUUID()}` }
  },
}

/**
 * MSG91's OTP API with our own code and the DLT-approved template (owner
 * decision 2026-10-16). UNVERIFIED until the account and the DLT template
 * exist (doc/10 A2): the request shape follows MSG91's documentation.
 */
const msg91Provider: SmsProvider = {
  name: "msg91",
  async sendOtp(to, code) {
    const env = getServerEnv()
    const query = new URLSearchParams({
      template_id: env.SMS_OTP_TEMPLATE_ID!,
      // MSG91 wants the country code without "+".
      mobile: to.replace(/^\+/, ""),
      otp: code,
    })
    const response = await fetch(
      `https://control.msg91.com/api/v5/otp?${query}`,
      {
        method: "POST",
        headers: { authkey: env.SMS_API_KEY!, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    )
    const body = (await response.json().catch(() => ({}))) as {
      type?: string
      request_id?: string
      message?: string
    }
    if (!response.ok || body.type !== "success") {
      // Never include the code or the full number in errors.
      throw new Error(
        `MSG91 OTP send failed: ${body.message ?? response.status}`,
      )
    }
    return { providerMessageId: body.request_id ?? `msg91-${Date.now()}` }
  },
}

function getProvider(): SmsProvider {
  switch (getServerEnv().SMS_PROVIDER) {
    case "fake":
      return fakeProvider
    case "msg91":
      return msg91Provider
  }
}

/** Latest fake OTP for a number — tests only. */
export function lastFakeOtp(to: string): string | undefined {
  return globalForSms.__duisFakeSms?.findLast((sms) => sms.to === to)?.code
}

/**
 * Sends a login OTP synchronously: the customer is waiting for it, so it does
 * not go through the job queue. The code itself is never stored or logged
 * outside the fake provider.
 */
export async function sendOtpSms(to: string, code: string): Promise<void> {
  const provider = getProvider()
  const recipient = maskPhone(to)
  try {
    const { providerMessageId } = await provider.sendOtp(to, code)
    await getDb().insert(notificationLogs).values({
      channel: "sms",
      template: "otp",
      recipient,
      status: "sent",
      provider: provider.name,
      providerMessageId,
      attempts: 1,
      sentAt: new Date(),
    })
  } catch (err) {
    await getDb()
      .insert(notificationLogs)
      .values({
        channel: "sms",
        template: "otp",
        recipient,
        status: "failed",
        provider: provider.name,
        attempts: 1,
        error: (err as Error).message.slice(0, 500),
      })
    throw err
  }
}
