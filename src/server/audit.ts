import "server-only"

import { auditLogs } from "@/db/schema"
import { describeActor, type Actor } from "@/server/auth/actor"
import type { Database } from "@/server/db/client"
import type { Transaction } from "@/server/db/transaction"

type AuditEntry = {
  action: string
  entityType: string
  entityId?: string | null
  changes?: Record<string, unknown> | null
}

const REDACTED_KEYS = /password|secret|token|otp|code$/i

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        REDACTED_KEYS.test(key) ? "[redacted]" : redact(inner),
      ]),
    )
  }
  return value
}

/**
 * Records a staff or system mutation. Call inside the same transaction as the
 * change so the audit entry exists if and only if the change does.
 */
export async function writeAudit(
  db: Database | Transaction,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  const who = describeActor(actor)
  await db.insert(auditLogs).values({
    actorType: who.actorType,
    actorUserId: who.actorUserId,
    actorRoles: who.actorRoles,
    ip: who.ip,
    requestId: actor.requestId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: entry.changes
      ? (redact(entry.changes) as Record<string, unknown>)
      : null,
  })
}
