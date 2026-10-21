/**
 * Expected business failures. Services throw these; actions and route
 * handlers map them to user-safe messages and HTTP statuses. Anything else is
 * an unexpected error: logged with the request id, never shown to users.
 */
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  STAFF_2FA_REQUIRED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INVALID_STATE: 409,
  OUT_OF_STOCK: 409,
  UNSUPPORTED_MEDIA: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
} as const

export type DomainErrorCode = keyof typeof ERROR_STATUS

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "DomainError"
    this.code = code
    this.details = details
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError
}

/** Postgres unique-violation on a named constraint (23505). */
/**
 * Postgres gave up on a transaction because of a lock conflict with another
 * one (deadlock, or a serialization failure). Nothing was written; trying
 * again usually succeeds.
 */
export function isLockConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error
  const code = (cause as { code?: string })?.code
  return code === "40P01" || code === "40001"
}

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error
  const pg = cause as { code?: string; constraint?: string }
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint)
}
