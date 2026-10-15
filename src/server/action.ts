import "server-only"
import { unstable_rethrow } from "next/navigation"

import { isDomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"

export type ActionError = {
  code: string
  message: string
  fieldErrors?: Record<string, string[] | undefined>
}

/**
 * Server Action error mapping, like errorResponse() for route handlers:
 * DomainErrors become user-safe messages (with field errors for forms);
 * anything else is logged and reported generically. Next.js control flow
 * (redirect, notFound) is re-thrown untouched.
 */
export function toActionError(error: unknown): ActionError {
  unstable_rethrow(error)
  if (isDomainError(error)) {
    const issues = error.details?.issues as ActionError["fieldErrors"]
    return { code: error.code, message: error.message, fieldErrors: issues }
  }
  logger.error({ err: error }, "unhandled server action error")
  return {
    code: "INTERNAL",
    message: "Something went wrong. Please try again.",
  }
}
