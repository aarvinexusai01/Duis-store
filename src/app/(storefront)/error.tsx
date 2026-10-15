"use client"

import { Button } from "@/components/ui/button"

/** Unexpected failures; the details are in the server log (by request id). */
export default function StorefrontError({
  retry,
}: {
  error: Error
  retry: () => void
}) {
  return (
    <div className="page-container flex flex-col items-start gap-4 py-24">
      <h1 className="display-heading text-5xl">Something went wrong</h1>
      <p className="text-muted-foreground">
        Sorry — this page didn&apos;t load. Please try again.
      </p>
      <Button onClick={() => retry()} className="h-11 rounded-none px-6">
        Try again
      </Button>
    </div>
  )
}
