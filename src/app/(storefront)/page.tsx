import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { SITE } from "@/config/site"
import {
  getPublishedSiteSettings,
  getResolvedPage,
} from "@/features/cms/queries"
import { Blocks } from "@/features/cms/ui/blocks"
import { SiteStructuredData } from "@/features/cms/ui/site-structured-data"

export async function generateMetadata(): Promise<Metadata> {
  await connection()
  const [page, settings] = await Promise.all([
    getResolvedPage("home"),
    getPublishedSiteSettings(),
  ])
  return {
    title: {
      absolute:
        page?.data.seo.title ?? settings?.defaultSeo.title ?? SITE.defaultTitle,
    },
    description:
      page?.data.seo.description ??
      settings?.defaultSeo.description ??
      SITE.defaultDescription,
    alternates: { canonical: page?.data.seo.canonical ?? "/" },
  }
}

/**
 * The first section (usually the hero, the LCP element) streams in its own
 * boundary: its reveal does not wait for the browser to parse every product
 * rail below it. Both halves share one cached read.
 */
export default function HomePage() {
  return (
    <>
      <Suspense fallback={<PageSkeleton variant="home" />}>
        <HomeSections part="first" />
      </Suspense>
      {/* A screen-tall placeholder keeps the footer out of view meanwhile. */}
      <Suspense fallback={<div aria-hidden className="min-h-dvh" />}>
        <HomeSections part="rest" />
      </Suspense>
    </>
  )
}

async function HomeSections({ part }: { part: "first" | "rest" }) {
  await connection()
  const blocks = (await getResolvedPage("home"))?.blocks ?? []
  if (part === "rest") {
    return (
      <>
        <Blocks blocks={blocks.slice(1)} startIndex={1} />
        {/* Brand and return policy for search results (Phase 11). */}
        <SiteStructuredData />
      </>
    )
  }
  const first = blocks[0]
  const heroHasHeading =
    first?.type === "hero_banner" && Boolean(first.slides[0]?.heading)
  return (
    <>
      {!heroHasHeading && <h1 className="sr-only">{SITE.defaultTitle}</h1>}
      <Blocks blocks={blocks.slice(0, 1)} />
    </>
  )
}
