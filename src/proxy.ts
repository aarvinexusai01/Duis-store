import { NextResponse, type NextRequest } from "next/server"

// Caddy sets X-Request-Id in production; accept only well-formed values so a
// client cannot inject arbitrary text into logs.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

/**
 * Runs before every matched request. It is not a security boundary:
 * authorization is enforced inside every Server Action and service.
 */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get("x-request-id")
  const requestId =
    incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()

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
