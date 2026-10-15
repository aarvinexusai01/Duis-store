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

function getProvider(): SmsProvider {
  switch (getServerEnv().SMS_PROVIDER) {
    case "fake":
      return fakeProvider
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
