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
    alternates: { canonical: "/" },
  }
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton variant="home" />}>
      <Home />
    </Suspense>
  )
}

async function Home() {
  await connection()
  const page = await getResolvedPage("home")
  const blocks = page?.blocks ?? []
  const first = blocks[0]
  const heroHasHeading =
    first?.type === "hero_banner" && Boolean(first.slides[0]?.heading)
  return (
    <>
      {!heroHasHeading && <h1 className="sr-only">{SITE.defaultTitle}</h1>}
      <Blocks blocks={blocks} />
    </>
  )
}
