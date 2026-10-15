import type { Route } from "next"
import Link from "next/link"
import { Fragment } from "react"

import { JsonLd } from "@/components/json-ld"
import { cn } from "@/lib/utils"
import { absoluteUrl } from "@/server/site-url"

export type Crumb = { label: string; href: string }

/** Visible trail plus BreadcrumbList JSON-LD; the last crumb is the page. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[]
  className?: string
}) {
  const trail = [{ label: "Home", href: "/" }, ...items]
  return (
    <>
      <nav aria-label="Breadcrumb" className={cn("text-xs", className)}>
        <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1
            return (
              <Fragment key={crumb.href}>
                <li>
                  {last ? (
                    <span aria-current="page" className="text-foreground">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href as Route}
                      className="hover:text-foreground hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </li>
                {!last && (
                  <li aria-hidden className="select-none">
                    /
                  </li>
                )}
              </Fragment>
            )
          })}
        </ol>
      </nav>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.label,
            item: absoluteUrl(crumb.href),
          })),
        }}
      />
    </>
  )
}
