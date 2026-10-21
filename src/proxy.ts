import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server"

import { countHit, findRedirect } from "@/server/redirects/proxy-table"

// Caddy sets X-Request-Id in production; accept only well-formed values so a
// client cannot inject arbitrary text into logs.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

/**
 * Runs before every matched request. It is not a security boundary:
 * authorization is enforced inside every Server Action and service.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const incoming = request.headers.get("x-request-id")
  const requestId =
    incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()

  // Old addresses (ADR-0029): a real 301/302, keeping the query string.
  if (request.method === "GET" || request.method === "HEAD") {
    const target = await findRedirect(request.nextUrl.pathname)
    if (target) {
      const destination = new URL(target.to, request.url)
      if (!target.to.includes("?")) destination.search = request.nextUrl.search
      event.waitUntil(countHit(request.nextUrl.pathname))
      const response = NextResponse.redirect(destination, target.status)
      response.headers.set("x-request-id", requestId)
      return response
    }
  }

  const headers = new Headers(request.headers)
  headers.set("x-request-id", requestId)

  const response = NextResponse.next({ request: { headers } })
  response.headers.set("x-request-id", requestId)
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|media/|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
}
