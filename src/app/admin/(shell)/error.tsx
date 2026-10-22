"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * Unexpected failures inside the admin, shown within its layout so the
 * sidebar stays usable. The details are in the server log and Sentry.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-12">
      <h1 className="text-2xl font-semibold">This page didn&apos;t load</h1>
      <p className="text-sm text-muted-foreground">
        Nothing was changed. Try again; if it keeps happening, the error
        reference below helps find it in the logs.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" render={<Link href="/admin" />}>
          Dashboard
        </Button>
      </div>
    </div>
  )
}
