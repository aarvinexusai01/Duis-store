import type { Metadata, Route } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { connection } from "next/server"

import { Breadcrumbs } from "@/components/breadcrumbs"

import { getResolvedPage } from "../queries"
import { pageHref } from "../resolve"
import { Blocks } from "./blocks"

// Checked before any lookup so arbitrary paths never become cache entries.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A published CMS page at its one canonical URL (pageHref): /about,
 * /policies/privacy-policy, /pages/<slug>. Any other path that names the
 * page redirects there, so no page is reachable twice.
 */
export async function CmsPageView({
  slug,
  path,
}: {
  slug: string
  path: string
}) {
  await connection()
  if (!SLUG.test(slug)) notFound()
  const page = await getResolvedPage(slug)
  if (!page || page.type === "home") notFound()
  const canonical = pageHref(page.slug)
  if (canonical !== path) permanentRedirect(canonical as Route)

  return (
    <article>
      <header className="page-container pt-6 pb-2">
        <Breadcrumbs items={[{ label: page.title, href: canonical }]} />
        <h1 className="mt-6 display-heading text-5xl sm:text-6xl">
          {page.title}
        </h1>
      </header>
      <Blocks blocks={page.blocks} />
    </article>
  )
}

export async function cmsPageMetadata(slug: string): Promise<Metadata> {
  await connection()
  const page = SLUG.test(slug) ? await getResolvedPage(slug) : null
  if (!page) return { title: "Page not found", robots: { index: false } }
  const seo = page.data.seo
  return {
    title: seo.title ?? page.title,
    description: seo.description,
    alternates: { canonical: pageHref(page.slug) },
    robots: seo.noindex ? { index: false, follow: true } : undefined,
  }
}
