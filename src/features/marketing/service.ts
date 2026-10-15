import "server-only"
import { and, eq, gt } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { newsletterSubscribers } from "@/db/schema"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"
import { hashToken, newToken, TOKEN_PATTERN } from "@/server/security/tokens"

// One confirmation email per address per 10 minutes, so the form cannot be
// used to flood someone's inbox.
const RESEND_AFTER_MS = 10 * 60 * 1000
const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const subscribeNewsletterSchema = z.object({
  email: z.email("Enter a valid email address.").max(254).toLowerCase(),
  source: z.enum(["footer", "home", "account"]).default("footer"),
})

/**
 * Double opt-in (DPDP): the address only counts as subscribed once the
 * emailed link is confirmed. The caller sees the same outcome whether the
 * address was new, pending or already confirmed, so the form cannot be used
 * to find out who subscribes.
 */
export const subscribeNewsletter = defineOperation({
  name: "marketing.subscribeNewsletter",
  access: "public",
  input: subscribeNewsletterSchema,
  async handler({ log }, { email, source }) {
    await withTransaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, email))
        .for("update")
      if (existing?.status === "confirmed") return
      if (
        existing?.status === "pending" &&
        Date.now() - existing.updatedAt.getTime() < RESEND_AFTER_MS
      ) {
        return
      }

      const token = newToken()
      const values = {
        status: "pending" as const,
        confirmTokenHash: hashToken(token),
        consentAt: new Date(),
        confirmedAt: null,
        unsubscribedAt: null,
        source,
      }
      if (existing) {
        await tx
          .update(newsletterSubscribers)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(newsletterSubscribers.id, existing.id))
      } else {
        const inserted = await tx
          .insert(newsletterSubscribers)
          .values({ email, ...values })
          .onConflictDoNothing()
          .returning({ id: newsletterSubscribers.id })
        // A concurrent request for the same address got there first.
        if (inserted.length === 0) return
      }

      const url = new URL("/newsletter/confirm", getServerEnv().APP_URL)
      url.searchParams.set("token", token)
      await queueEmail(
        {
          template: "newsletter-confirm",
          to: email,
          props: { url: url.toString() },
        },
        { tx },
      )
      log.info({ source }, "newsletter confirmation queued")
    })
  },
})

export const confirmNewsletter = defineOperation({
  name: "marketing.confirmNewsletter",
  access: "public",
  input: z.object({ token: z.string().regex(TOKEN_PATTERN) }),
  async handler(_ctx, { token }): Promise<"confirmed" | "invalid"> {
    const now = new Date()
    const updated = await getDb()
      .update(newsletterSubscribers)
      .set({
        status: "confirmed",
        confirmedAt: now,
        confirmTokenHash: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(newsletterSubscribers.confirmTokenHash, hashToken(token)),
          eq(newsletterSubscribers.status, "pending"),
          gt(
            newsletterSubscribers.updatedAt,
            new Date(now.getTime() - CONFIRM_TTL_MS),
          ),
        ),
      )
      .returning({ id: newsletterSubscribers.id })
    return updated.length > 0 ? "confirmed" : "invalid"
  },
})
