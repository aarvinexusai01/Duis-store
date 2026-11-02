import "server-only"
import { z } from "zod"

import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"
import {
  consentFields,
  hasCurrentConsent,
  recordConsents,
} from "@/server/privacy"

/**
 * A signed-in customer who hasn't seen this notice version ticks the account
 * and age boxes once (Act s.5(2), doc/06 Phase 12).
 */
export const acceptAccountNotice = defineOperation({
  name: "privacy.acceptAccountNotice",
  access: "authenticated",
  input: z.object(consentFields),
  async handler({ actor }, { consentLanguage }) {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    if (await hasCurrentConsent(getDb(), actor.userId, "account")) return
    await recordConsents(getDb(), {
      userId: actor.userId,
      purposes: ["account", "age"],
      source: "notice_prompt",
      language: consentLanguage,
    })
  },
})
