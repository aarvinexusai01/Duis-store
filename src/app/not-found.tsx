import type { Metadata } from "next"
import Link from "next/link"

import { Wordmark } from "@/components/brand/wordmark"
import { buttonVariants } from "@/components/ui/button"
import { SHOP_HREF } from "@/config/routes"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center"
    >
      <Wordmark className="text-5xl" />
      <h1 className="display-heading text-6xl sm:text-8xl">404</h1>
      <p className="max-w-md text-muted-foreground">
        This page doesn&apos;t exist — maybe it sold out, maybe it never was.
      </p>
      <div className="flex gap-3">
        <Link
          href="/"
          className={cn(buttonVariants(), "h-11 rounded-none px-6")}
        >
          Home
        </Link>
        <Link
          href={SHOP_HREF}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 rounded-none px-6",
          )}
        >
          Shop all
        </Link>
      </div>
    </main>
  )
}
