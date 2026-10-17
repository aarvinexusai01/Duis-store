import type { PageData } from "./schemas"

export type RevisionDiff = {
  added: number
  removed: number
  edited: number
  moved: number
  seo: boolean
}

/**
 * What changed between two versions of a page, by section id: for the
 * revision history ("2 sections edited, 1 added").
 */
export function diffPages(
  before: PageData | null,
  after: PageData,
): RevisionDiff {
  const old = new Map(
    (before?.sections ?? []).map((section, index) => [
      section.id,
      { json: JSON.stringify(section), index },
    ]),
  )
  const kept = after.sections.filter((section) => old.has(section.id))
  const oldOrder = (before?.sections ?? [])
    .filter((section) => after.sections.some((s) => s.id === section.id))
    .map((section) => section.id)
  return {
    added: after.sections.length - kept.length,
    removed: (before?.sections.length ?? 0) - kept.length,
    edited: kept.filter(
      (section) => old.get(section.id)!.json !== JSON.stringify(section),
    ).length,
    moved: kept.filter((section, i) => oldOrder[i] !== section.id).length,
    seo:
      before !== null &&
      JSON.stringify(before.seo ?? {}) !== JSON.stringify(after.seo ?? {}),
  }
}

/** "2 sections edited, 1 added, SEO changed" or "No changes". */
export function describeDiff(diff: RevisionDiff, first: boolean): string {
  if (first) return "First version"
  const parts = [
    diff.added && `${diff.added} added`,
    diff.removed && `${diff.removed} removed`,
    diff.edited && `${diff.edited} edited`,
    diff.moved && `${diff.moved} moved`,
  ].filter(Boolean)
  const sections = parts.length > 0 ? `Sections: ${parts.join(", ")}` : ""
  const seo = diff.seo ? "SEO changed" : ""
  return [sections, seo].filter(Boolean).join("; ") || "No changes"
}
