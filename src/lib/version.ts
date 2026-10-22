import { z } from "zod"

/**
 * Record versions for overlapping admin edits (doc/06 Phase 8 audit): an
 * editor loads a record's version (its updated_at) and sends it back on save.
 * Optional, so scripts and bulk tools can still save directly. Safe for the
 * client; the check itself is checkVersion in server/db/versioning.ts.
 */
export const expectedVersionField = z.iso.datetime({ offset: true }).optional()

export function versionOf(updatedAt: Date | string): string {
  return new Date(updatedAt).toISOString()
}
