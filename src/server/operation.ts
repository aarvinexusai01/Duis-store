import "server-only"
import { z } from "zod"

import type { Actor } from "@/server/auth/actor"
import { rolesAllow, type PermissionRequest } from "@/server/auth/permissions"
import { isStaff } from "@/server/auth/roles"
import { DomainError } from "@/server/errors"
import { logger, type Logger } from "@/server/observability/logger"

/**
 * Who may call an operation:
 * - "public": anyone, including anonymous visitors
 * - "authenticated": any signed-in user (ownership is checked by the handler)
 * - a permission request: staff with a role granting it, and 2FA enabled
 * System actors (jobs, seed, CLI) pass every check.
 */
export type OperationAccess = "public" | "authenticated" | PermissionRequest

export type OperationContext = { actor: Actor; log: Logger }

type OperationDefinition<Input extends z.ZodType, Output> = {
  name: string
  access: OperationAccess
  input: Input
  handler(ctx: OperationContext, input: z.output<Input>): Promise<Output>
}

export type Operation<Input extends z.ZodType, Output> = ((
  actor: Actor,
  input: z.input<Input>,
) => Promise<Output>) & { definition: OperationDefinition<Input, Output> }

/** Every operation, by name — the RBAC matrix test calls each of them. */
export const operationRegistry = new Map<
  string,
  Operation<z.ZodType, unknown>
>()

export function authorize(actor: Actor, access: OperationAccess): void {
  if (access === "public" || actor.kind === "system") return

  if (actor.kind === "anonymous") {
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  }
  if (access === "authenticated") return

  if (!rolesAllow(actor.roles, access)) {
    throw new DomainError("FORBIDDEN", "You do not have permission to do this.")
  }
  if (isStaff(actor.roles) && !actor.twoFactorEnabled) {
    throw new DomainError(
      "STAFF_2FA_REQUIRED",
      "Set up two-factor authentication to use staff tools.",
    )
  }
}

/**
 * Defines a service entry point: authorize → validate input → run handler.
 * Authorization comes first, so a forbidden caller learns nothing about the
 * expected input.
 */
export function defineOperation<Input extends z.ZodType, Output>(
  definition: OperationDefinition<Input, Output>,
): Operation<Input, Output> {
  // Two operations with one name is a bug (the RBAC test would miss one).
  // In development, hot reload runs an edited module again while the
  // registry survives, so its operations replace their earlier selves.
  if (
    operationRegistry.has(definition.name) &&
    process.env.NODE_ENV !== "development"
  ) {
    throw new Error(`Duplicate operation name: ${definition.name}`)
  }

  const run = async (actor: Actor, rawInput: z.input<Input>) => {
    authorize(actor, definition.access)

    const parsed = definition.input.safeParse(rawInput)
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Some fields are invalid.", {
        issues: z.flattenError(parsed.error).fieldErrors,
        formErrors: z.flattenError(parsed.error).formErrors,
      })
    }

    const log = logger.child({
      op: definition.name,
      requestId: actor.requestId,
      actorId: actor.kind === "user" ? actor.userId : actor.kind,
    })
    return definition.handler({ actor, log }, parsed.data)
  }

  const operation = Object.assign(run, { definition })
  operationRegistry.set(
    definition.name,
    operation as unknown as Operation<z.ZodType, unknown>,
  )
  return operation
}
