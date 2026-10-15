import { Skeleton } from "@/components/ui/skeleton"

/** Shell placeholder while request-time content streams in. */
export function PageSkeleton({
  variant = "page",
}: {
  variant?: "page" | "grid" | "product" | "home"
}) {
  if (variant === "home") {
    // Matches the hero's box so the streamed homepage does not shift.
    return (
      <div aria-busy aria-label="Loading" className="min-h-dvh">
        <Skeleton className="aspect-[4/5] w-full rounded-none sm:aspect-[16/9] lg:aspect-[21/9]" />
      </div>
    )
  }
  // At least a screen tall, so the footer never shows in the first paint and
  // then jumps away when the content arrives.
  return (
    <div
      className="page-container min-h-dvh py-8"
      aria-busy
      aria-label="Loading"
    >
      {variant === "product" ? (
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="aspect-[4/5] w-full" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      ) : variant === "grid" ? (
        <>
          <Skeleton className="mb-8 h-12 w-1/3" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/5] w-full" />
            ))}
          </div>
        </>
      ) : (
        <>
          <Skeleton className="mb-6 h-12 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </>
      )}
    </div>
  )
}
