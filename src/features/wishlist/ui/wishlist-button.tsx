"use client"

import { HeartIcon } from "lucide-react"
import type { Route } from "next"
import { usePathname, useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { setWishlisted } from "../actions"
import { markWishlisted, useWishlistState } from "./store"

export function WishlistButton({
  productId,
  productTitle,
  className,
  withLabel = false,
}: {
  productId: string
  productTitle: string
  className?: string
  withLabel?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { ids } = useWishlistState()
  const [pending, startTransition] = useTransition()
  const saved = ids.has(productId)

  const toggle = () =>
    startTransition(async () => {
      markWishlisted(productId, !saved)
      const result = await setWishlisted(productId, !saved)
      if (result.status === "signin") {
        markWishlisted(productId, saved)
        router.push(`/login?next=${encodeURIComponent(pathname)}` as Route)
      } else if (result.status === "error") {
        markWishlisted(productId, saved)
        toast.error(result.message)
      } else {
        toast.success(
          result.status === "saved"
            ? "Saved to wishlist"
            : "Removed from wishlist",
        )
      }
    })

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors",
        withLabel
          ? "h-12 border border-ink px-4 text-sm font-semibold tracking-wide uppercase hover:bg-ink hover:text-paper"
          : "size-9 rounded-full bg-paper/90 text-ink shadow-sm hover:bg-paper",
        className,
      )}
    >
      <HeartIcon
        className={cn("size-4.5", saved && "fill-rust text-rust")}
        aria-hidden
      />
      {withLabel ? (
        saved ? (
          "Saved"
        ) : (
          "Wishlist"
        )
      ) : (
        <span className="sr-only">
          {saved ? "Remove" : "Save"} {productTitle} {saved ? "from" : "to"}{" "}
          wishlist
        </span>
      )}
    </button>
  )
}
