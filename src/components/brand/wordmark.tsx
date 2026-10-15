import Link from "next/link"

import { SITE } from "@/config/site"
import { cn } from "@/lib/utils"

/** The DUIS text wordmark; links home. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "font-display text-3xl leading-none tracking-[0.06em] uppercase",
        className,
      )}
    >
      {SITE.name}
      <span className="sr-only"> home</span>
    </Link>
  )
}
