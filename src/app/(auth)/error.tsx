"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"

/** Unexpected failures on the sign-in pages, inside their layout. */
export default function AuthError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="display-heading text-4xl">Something went wrong</h1>
      <p className="text-muted-foreground">
        Sorry, this page didn&apos;t load. Please try again.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => retry()} className="h-11 rounded-none px-6">
          Try again
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-none px-6"
          render={<Link href="/" />}
        >
          Home
        </Button>
      </div>
    </div>
  )
}
