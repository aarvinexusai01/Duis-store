import { getActor } from "@/server/auth/session"

import { listWishlist } from "../service"
import { WishlistSyncClient } from "./wishlist-sync"

/** Request-time island in the storefront layout (inside <Suspense>). */
export async function WishlistSync() {
  const actor = await getActor()
  if (actor.kind !== "user")
    return <WishlistSyncClient signedIn={false} ids={[]} />
  return <WishlistSyncClient signedIn ids={await listWishlist(actor, {})} />
}
