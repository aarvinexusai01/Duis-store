import "server-only"

import { loadCatalogTree } from "@/features/catalog"

import { resolvePageBlocks } from "../resolve"
import type { PreviewPage } from "../workflow"
import { Blocks } from "./blocks"

/**
 * Renders a revision exactly as the live page would: the same resolver and
 * block components, from the revision's data instead of the published one.
 */
export async function PreviewPageView({ preview }: { preview: PreviewPage }) {
  const blocks = await resolvePageBlocks(preview.data, await loadCatalogTree())
  const expires = preview.expiresAt.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })
  return (
    <>
      <p
        role="status"
        className="sticky top-0 z-40 bg-mustard px-4 py-2 text-center text-sm font-semibold text-ink"
      >
        Preview of version {preview.version}, not live. This link works until{" "}
        {expires}.
      </p>
      {preview.type === "home" ? (
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
      )}
    </>
  )
}
