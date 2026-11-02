import "server-only"

import { getActor } from "@/server/auth/session"
import { getDb } from "@/server/db/client"
import { hasCurrentConsent } from "@/server/privacy"

export async function hasAcceptedAccountNotice(): Promise<
  "signed_out" | "accepted" | "needed"
> {
  const actor = await getActor()
  if (actor.kind !== "user") return "signed_out"
  return (await hasCurrentConsent(getDb(), actor.userId, "account"))
    ? "accepted"
    : "needed"
}
