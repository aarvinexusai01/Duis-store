import "server-only"
import { createHmac } from "node:crypto"

import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { dataConsents } from "@/db/schema"
import {
  NOTICE_LANGUAGES,
  NOTICE_UI,
  NOTICE_VERSION,
  type ConsentPurpose,
  type NoticeLanguage,
} from "@/lib/privacy"
import type { Database } from "@/server/db/client"
import type { Transaction } from "@/server/db/transaction"

/**
 * DPDP consent records (doc/06 Phase 12). Every form that takes personal
 * data sends `consent: true` from an unticked-by-default box; the operation
 * refuses without it and records it here with the notice version, which is
 * the shop's proof under Act s.6(10).
 */

/** Spread into an operation's input: the tick, and the notice language. */
export const consentFields = {
  consent: z.literal(true, { error: NOTICE_UI.en.required }),
  consentLanguage: z.enum(NOTICE_LANGUAGES).default("en"),
}

/** A guest's email or phone, keyed so the record proves who without storing it. */
export function consentSubjectHash(subject: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`dpdp-consent:${subject.trim().toLowerCase()}`)
    .digest("hex")
}

export async function recordConsents(
  db: Database | Transaction,
  input: {
    userId?: string | null
    /** For guests: their email or phone. */
    subject?: string | null
    purposes: readonly ConsentPurpose[]
    granted?: boolean
    source: string
    language?: NoticeLanguage
    reference?: { type: string; id: string }
    userAgent?: string | null
  },
): Promise<void> {
  const subjectHash = input.subject ? consentSubjectHash(input.subject) : null
  if (!input.userId && !subjectHash) {
    throw new Error("a consent needs a user or a subject")
  }
  await db.insert(dataConsents).values(
    input.purposes.map((purpose) => ({
      userId: input.userId ?? null,
      subjectHash,
      purpose,
      granted: input.granted ?? true,
      noticeVersion: NOTICE_VERSION,
      language: input.language ?? "en",
      source: input.source,
      referenceType: input.reference?.type ?? null,
      referenceId: input.reference?.id ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })),
  )
}

/** Whether the user's latest answer for a purpose, at this notice version, is yes. */
export async function hasCurrentConsent(
  db: Database | Transaction,
  userId: string,
  purpose: ConsentPurpose,
): Promise<boolean> {
  const [latest] = await db
    .select({ granted: dataConsents.granted })
    .from(dataConsents)
    .where(
      and(
        eq(dataConsents.userId, userId),
        eq(dataConsents.purpose, purpose),
        eq(dataConsents.noticeVersion, NOTICE_VERSION),
      ),
    )
    .orderBy(desc(dataConsents.createdAt))
    .limit(1)
  return latest?.granted === true
}
