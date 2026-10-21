import "server-only"

import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader, type ChromeDraft } from "@/components/layout/site-header"
import { loadCatalogTree } from "@/features/catalog"

import { getResolvedPage } from "../queries"
import { resolvePageBlocks } from "../resolve"
import type { PreviewPage } from "../workflow"
import { Blocks } from "./blocks"

/**
 * Renders a revision exactly as the live site would: the same resolver and
 * components, from the revision's data instead of the published one. A menu
 * or settings draft is shown around the live home page.
 */
export async function PreviewPageView({ preview }: { preview: PreviewPage }) {
  const expires = preview.expiresAt.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })
  const draft: ChromeDraft | undefined =
    preview.kind === "navigation"
      ? { navigation: { key: preview.key, data: preview.data } }
      : preview.kind === "site_settings"
        ? { settings: preview.data }
        : undefined
  const what =
    preview.kind === "page"
      ? "this page"
      : preview.kind === "navigation"
        ? `the ${preview.key} menu`
        : "the site settings"

  let body: React.ReactNode
  if (preview.kind === "page") {
    const blocks = await resolvePageBlocks(
      preview.data,
      await loadCatalogTree(),
    )
    body =
      preview.type === "home" ? (
        <Blocks blocks={blocks} />
      ) : (
        <article>
          <header className="page-container pt-6 pb-2">
            <h1 className="mt-6 display-heading text-5xl sm:text-6xl">
              {preview.title}
            </h1>
          </header>
          <Blocks blocks={blocks} />
        </article>
      )
  } else {
    body = <Blocks blocks={(await getResolvedPage("home"))?.blocks ?? []} />
  }

  return (
    <>
      <p
        role="status"
        className="bg-mustard px-4 py-2 text-center text-sm font-semibold text-ink"
      >
        Preview of version {preview.version} of {what}, not live. This link
        works until {expires}.
      </p>
      <SiteHeader draft={draft} />
      <main id="main" className="flex-1">
        {body}
      </main>
      <SiteFooter draft={draft} />
    </>
  )
}
