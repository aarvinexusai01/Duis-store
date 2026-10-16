import "server-only"

import { adminCatalogOptions } from "@/features/catalog"
import { adminListCollections } from "@/features/collections"
import { can } from "@/features/staff"
import type { UserActor } from "@/server/auth/actor"

/** Categories and collections a discount can target. */
export async function targetOptions(actor: UserActor) {
  const [catalog, collections] = await Promise.all([
    can(actor, { catalog: ["read"] })
      ? adminCatalogOptions(actor, {})
      : Promise.resolve(null),
    can(actor, { collection: ["read"] })
      ? adminListCollections(actor, {})
      : Promise.resolve([]),
  ])
  return {
    categories: (catalog?.categories ?? []).map((c) => ({
      id: c.id,
      label: `${"— ".repeat(c.depth)}${c.name}`,
    })),
    collections: collections
      .filter((c) => c.status !== "archived")
      .map((c) => ({ id: c.id, label: c.title })),
  }
}
