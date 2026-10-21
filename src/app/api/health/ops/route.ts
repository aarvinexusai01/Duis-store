import { connection } from "next/server"

import { loadOpsChecks } from "@/features/system"
import { logger } from "@/server/observability/logger"

/**
 * Server checks for the external uptime monitor (doc/07 §7): 503 when any
 * check fails, so ops hear about it even if the worker that sends alert
 * emails is down. The body says only how many fail; details are on the
 * System page.
 */
export async function GET() {
  await connection()
  try {
    const failing = (await loadOpsChecks()).filter((c) => !c.ok).length
    return Response.json(
      { status: failing === 0 ? "ok" : "attention", failing },
      {
        status: failing === 0 ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  } catch (err) {
    logger.warn({ err }, "ops checks could not be loaded")
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
