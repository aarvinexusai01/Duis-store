import type { Metadata, Route } from "next"
import type { ReactNode } from "react"
import { notFound, permanentRedirect } from "next/navigation"
import { connection } from "next/server"

import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { richTextToPlainText } from "@/lib/rich-text"
import { fitDescription } from "@/lib/seo"

import { getResolvedPage } from "../queries"
import { pageHref, type ResolvedBlock } from "../resolve"
import { Blocks } from "./blocks"

/** The page's own words, for a description when staff haven't written one. */
function pageText(blocks: ResolvedBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (
      block.type === "rich_text" ||
      block.type === "brand_story" ||
      block.type === "image_with_text"
    ) {
      parts.push(richTextToPlainText(block.content))
    } else if (block.type === "faq_list") {
      parts.push(...block.items.map((item) => item.question))
    }
    if (parts.join(" ").length > 400) break
  }
  return parts.join(" ")
}

/** FAQPage markup from the page's question-and-answer blocks (Phase 11). */
function faqStructuredData(blocks: ResolvedBlock[]) {
  const items = blocks.flatMap((block) =>
    block.type === "faq_list" ? block.items : [],
  )
  if (items.length === 0) return null
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: richTextToPlainText(item.answer),
      },
    })),
  }
}

// Checked before any lookup so arbitrary paths never become cache entries.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A published CMS page at its one canonical URL (pageHref): /about,
 * /policies/privacy-policy, /pages/<slug>. Any other path that names the
 * page redirects there, so no page is reachable twice. `children` render
 * after the content (e.g. the contact form).
 */
export async function CmsPageView({
  slug,
  path,
  children,
}: {
  slug: string
  path: string
  children?: ReactNode
}) {
  await connection()
  if (!SLUG.test(slug)) notFound()
  const page = await getResolvedPage(slug)
  if (!page || page.type === "home") notFound()
  const canonical = pageHref(page.slug)
  if (canonical !== path) permanentRedirect(canonical as Route)
  const faq = faqStructuredData(page.blocks)

  return (
    <article>
      <header className="page-container pt-6 pb-2">
        <Breadcrumbs items={[{ label: page.title, href: canonical }]} />
        <h1 className="mt-6 display-heading text-5xl sm:text-6xl">
          {page.title}
        </h1>
        {page.type === "policy" && page.publishedAt && (
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated{" "}
            {new Date(page.publishedAt).toLocaleDateString("en-IN", {
              dateStyle: "long",
              timeZone: "Asia/Kolkata",
            })}
          </p>
        )}
      </header>
      <Blocks blocks={page.blocks} />
      {faq && <JsonLd data={faq} />}
      {children && (
        <div className="page-container max-w-3xl pb-16">{children}</div>
      )}
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
    description:
      seo.description ?? (fitDescription(pageText(page.blocks)) || undefined),
    alternates: { canonical: seo.canonical ?? pageHref(page.slug) },
    robots: seo.noindex ? { index: false, follow: true } : undefined,
  }
}
