/**
 * Removes personal data from error reports before they leave the server or
 * the browser (doc/08, doc/10: Sentry SaaS with PII scrubbed). Shared by the
 * web server, the browser and the worker. Errors are still useful without
 * it: stack traces, routes and release are kept.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Indian mobile numbers with or without +91, and any other long digit run.
const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b|\b\d{11,}\b/g
// Query parameters that carry secrets: preview and reset tokens, OTPs, keys.
const SECRET_PARAM =
  /([?&;]?[\w-]*(?:token|code|otp|key|secret|signature|sig|session|password|auth)[\w-]*=)[^&#;\s]*/gi
const SECRET_PATH = /\/(preview|reset-password|verify-email)\/[^/?#\s]+/gi

// Headers that are safe and useful; every other one is dropped.
const KEEP_HEADERS = new Set(["user-agent", "content-type", "accept-language"])

export function scrubText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(SECRET_PARAM, "$1[redacted]")
    .replace(SECRET_PATH, "/$1/[redacted]")
}

type Scrubbable = {
  message?: string
  user?: { id?: string | number } & Record<string, unknown>
  request?: {
    url?: string
    query_string?: unknown
    cookies?: unknown
    data?: unknown
    headers?: Record<string, string>
    env?: unknown
  }
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
}

function scrubUnknown(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value)
  if (depth > 4 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((v) => scrubUnknown(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, scrubUnknown(v, depth + 1)]),
  )
}

export function scrubEvent<E extends Scrubbable>(event: E): E {
  if (event.user) {
    const { id } = event.user
    event.user = id === undefined ? undefined : { id }
  }
  if (event.message) event.message = scrubText(event.message)
  const request = event.request
  if (request) {
    delete request.cookies
    delete request.data
    delete request.env
    if (request.url) request.url = scrubText(request.url)
    if (typeof request.query_string === "string") {
      request.query_string = scrubText(request.query_string)
    } else if (request.query_string) {
      delete request.query_string
    }
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) =>
          KEEP_HEADERS.has(name.toLowerCase()),
        ),
      )
    }
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubText(value.value)
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message)
    if (crumb.data) crumb.data = scrubUnknown(crumb.data) as typeof crumb.data
  }
  if (event.extra) event.extra = scrubUnknown(event.extra) as typeof event.extra
  return event
}

/**
 * What the SDK may collect in the first place (Sentry's `dataCollection`).
 * Local variables in stack frames are off: they can hold addresses, phone
 * numbers or tokens that no pattern above would recognise.
 */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { allow: [...KEEP_HEADERS] },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
}
