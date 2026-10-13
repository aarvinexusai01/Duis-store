import { connection } from "next/server"

/** Liveness: the process is up and serving. No dependency checks. */
export async function GET() {
  await connection()
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  )
}
