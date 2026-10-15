import type { Route } from "next"
import Link from "next/link"

import { cn } from "@/lib/utils"

type SectionHeadingProps = {
  title: string
  href?: string
  linkLabel?: string
  className?: string
}

export function SectionHeading({
  title,
  href,
  linkLabel = "View all",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-4", className)}>
      <h2 className="display-heading text-3xl sm:text-4xl">{title}</h2>
      {href && (
        <Link
          href={href as Route}
          className="shrink-0 text-sm font-semibold underline underline-offset-4 hover:text-rust"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
