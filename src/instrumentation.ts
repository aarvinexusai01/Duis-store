/**
 * Runs once when a server instance starts. Validates configuration so a
 * misconfigured replica fails its health check instead of serving errors.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // Builds run without runtime secrets; validation happens on server start.
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { getServerEnv } = await import("@/config/env")
  getServerEnv()
}
