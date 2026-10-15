/**
 * Normalises a search box query: trimmed, single-spaced, lower-cased and
 * capped, so equivalent queries share one cache entry. Empty means "no query".
 */
export function normaliseSearchQuery(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 64)
}

/** Shortest query the autocomplete answers. */
export const MIN_SUGGEST_LENGTH = 2
