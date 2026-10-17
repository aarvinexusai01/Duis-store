import "server-only"
import { constants } from "node:fs"
import { access, mkdir } from "node:fs/promises"
import path from "node:path"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { getPaymentGateway } from "@/features/payments"
import { getShippingProvider } from "@/features/shipping"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

/**
 * Which providers are live (doc/06 Phase 4 §12), and a "test connection"
 * per provider. Never returns keys or passwords: only the mode and host.
 */

export type IntegrationStatus = {
  key:
    | "payments"
    | "shipping"
    | "email"
    | "sms"
    | "whatsapp"
    | "analytics"
    | "storage"
    | "worker"
  label: string
  provider: string
  mode: "live" | "test" | "demo" | "problem"
  detail: string
  testable: boolean
}

async function workerHeartbeat(): Promise<Date | null> {
  const result = await getDb().execute<{ at: Date | null }>(sql`
    select max(completed_on) as at from pgboss.job
    where name = 'system.heartbeat' and state = 'completed'`)
  const at = result.rows[0]?.at
  return at ? new Date(at) : null
}

export const getIntegrationHealth = defineOperation({
  name: "settings.integrationHealth",
  access: { settings: ["read"] },
  input: z.object({}),
  async handler(): Promise<IntegrationStatus[]> {
    const env = getServerEnv()
    const [heartbeat, email] = await Promise.all([
      workerHeartbeat(),
      getDb().execute<{ sent: Date | null; failed: Date | null }>(sql`
        select max(sent_at) as sent,
               max(updated_at) filter (where status = 'failed') as failed
        from notification_logs where channel = 'email'`),
    ])
    const lastSent = email.rows[0]?.sent ? new Date(email.rows[0].sent) : null
    const lastFailed = email.rows[0]?.failed
      ? new Date(email.rows[0].failed)
      : null
    const ago = (date: Date | null) =>
      date
        ? `${Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))} min ago`
        : "never"
    const workerOk =
      heartbeat !== null && Date.now() - heartbeat.getTime() < 3 * 60_000
    return [
      {
        key: "payments",
        label: "Payments",
        provider:
          env.PAYMENT_PROVIDER === "razorpay" ? "Razorpay" : "Simulated",
        mode:
          env.PAYMENT_PROVIDER === "fake"
            ? "demo"
            : env.RAZORPAY_KEY_ID?.startsWith("rzp_live_")
              ? "live"
              : "test",
        detail:
          env.PAYMENT_PROVIDER === "fake"
            ? "Nothing is charged."
            : env.RAZORPAY_KEY_ID?.startsWith("rzp_live_")
              ? "Live keys: real money."
              : "Test keys: no real money.",
        testable: true,
      },
      {
        key: "shipping",
        label: "Courier",
        provider:
          env.SHIPPING_PROVIDER === "shiprocket"
            ? "Shiprocket"
            : "Demo courier",
        mode: env.SHIPPING_PROVIDER === "shiprocket" ? "live" : "demo",
        detail:
          env.SHIPPING_PROVIDER === "shiprocket"
            ? `Pickup "${env.SHIPROCKET_PICKUP_LOCATION}" (${env.SHIPROCKET_PICKUP_PINCODE}). Not yet verified with a real parcel.`
            : "Fixed demo rates, AWBs and labels.",
        testable: true,
      },
      {
        key: "email",
        label: "Email",
        provider: `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}`,
        mode:
          lastFailed && (!lastSent || lastFailed > lastSent)
            ? "problem"
            : ["localhost", "127.0.0.1", "mailpit"].includes(env.SMTP_HOST)
              ? "demo"
              : "live",
        detail: `Last sent ${ago(lastSent)}${lastFailed ? `, last failure ${ago(lastFailed)}` : ""}.`,
        testable: true,
      },
      {
        key: "sms",
        label: "SMS (OTP)",
        provider: env.SMS_PROVIDER === "msg91" ? "MSG91" : "Logged only",
        mode: env.SMS_PROVIDER === "msg91" ? "live" : "demo",
        detail:
          env.SMS_PROVIDER === "msg91"
            ? "DLT template set. Not yet verified with a real code."
            : "Codes are written to the server log (development only).",
        testable: false,
      },
      {
        key: "whatsapp",
        label: "WhatsApp updates",
        provider:
          env.WHATSAPP_PROVIDER === "msg91"
            ? "MSG91"
            : env.WHATSAPP_PROVIDER === "fake"
              ? "Logged only"
              : "Off",
        mode: env.WHATSAPP_PROVIDER === "msg91" ? "live" : "demo",
        detail:
          env.WHATSAPP_PROVIDER === "msg91"
            ? "Sent to customers who opted in. Not yet verified with a real message."
            : "No WhatsApp messages are sent.",
        testable: false,
      },
      {
        key: "analytics",
        label: "Analytics",
        provider:
          [
            env.GA4_MEASUREMENT_ID && "GA4",
            env.META_PIXEL_ID && "Meta Pixel",
            env.META_CAPI_ACCESS_TOKEN && "Conversions API",
          ]
            .filter(Boolean)
            .join(", ") || "None",
        mode: env.GA4_MEASUREMENT_ID || env.META_PIXEL_ID ? "live" : "demo",
        detail:
          env.GA4_MEASUREMENT_ID || env.META_PIXEL_ID
            ? "Loads only for visitors who accept cookies."
            : "No measurement IDs set.",
        testable: false,
      },
      {
        key: "storage",
        label: "File storage",
        provider: "Local volumes",
        mode: "live",
        detail: `Media in ${env.MEDIA_ROOT}, private files in ${env.STORAGE_PRIVATE_ROOT}.`,
        testable: true,
      },
      {
        key: "worker",
        label: "Background worker",
        provider: "pg-boss",
        mode: workerOk ? "live" : "problem",
        detail: workerOk
          ? `Last heartbeat ${ago(heartbeat)}.`
          : `No heartbeat ${heartbeat ? `since ${ago(heartbeat)}` : "yet"}: emails, refunds and parcels wait until it runs.`,
        testable: false,
      },
    ]
  },
})

async function writable(dir: string) {
  const full = path.resolve(dir)
  await mkdir(full, { recursive: true })
  await access(full, constants.W_OK)
}

export const testIntegration = defineOperation({
  name: "settings.testIntegration",
  access: { settings: ["update"] },
  input: z.object({
    target: z.enum(["payments", "shipping", "email", "storage"]),
  }),
  async handler({ actor }, { target }) {
    const env = getServerEnv()
    let message: string
    try {
      switch (target) {
        case "payments":
          await getPaymentGateway().ping()
          message = "The payment gateway accepted our keys."
          break
        case "shipping":
          await getShippingProvider().ping()
          message = "The courier accepted our login."
          break
        case "storage":
          await writable(env.MEDIA_ROOT)
          await writable(env.STORAGE_PRIVATE_ROOT)
          message = "Both storage folders are writable."
          break
        case "email": {
          if (actor.kind !== "user")
            throw new DomainError("FORBIDDEN", "Staff only.")
          const me = await getDb().execute<{ email: string; name: string }>(
            sql`select email, name from users where id = ${actor.userId}`,
          )
          await queueEmail({
            template: "test-email",
            to: me.rows[0]!.email,
            props: { sentBy: me.rows[0]!.name },
            userId: actor.userId,
          })
          message = `A test email is on its way to ${me.rows[0]!.email}. If it doesn't arrive, check the worker and the SMTP settings.`
          break
        }
      }
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError(
        "CONFLICT",
        `The test failed: ${error instanceof Error ? error.message : "unknown error"}`,
      )
    }
    await withTransaction((tx) =>
      writeAudit(tx, actor, {
        action: "settings.test_integration",
        entityType: "integration",
        entityId: target,
      }),
    )
    return { message }
  },
})
