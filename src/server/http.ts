import "server-only"

import { isDomainError } from "@/server/errors"
import { logger } from "@/server/observability/logger"

/**
 * Route-handler error mapping: expected DomainErrors become their status and
 * a user-safe message; anything else is logged and reported as a plain 500.
 */
export function errorResponse(error: unknown, requestId?: string): Response {
  if (isDomainError(error)) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    )
  }
  logger.error({ err: error, requestId }, "unhandled route error")
  return Response.json(
    {
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    },
    { status: 500 },
  )
}
