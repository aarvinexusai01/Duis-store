import { connection } from "next/server"

import { checkReadiness } from "@/server/health"

/** Readiness: used by Caddy's active health checks and the deploy smoke test. */
export async function GET() {
  await connection()
  const report = await checkReadiness()
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
