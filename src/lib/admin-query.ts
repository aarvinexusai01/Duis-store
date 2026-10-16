/**
 * Admin list pages keep their state in the URL (?q=&status=&page=), so every
 * view is linkable and works without JavaScript.
 */
export type RawSearch = Record<string, string | string[] | undefined>

export function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v && v.trim() ? v.trim() : undefined
}

export function pageOf(raw: RawSearch): number {
  const n = Number(one(raw.page))
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 10_000) : 1
}

/** Picks a value only if it is one of the allowed ones. */
export function choice<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

export function withParams(
  basePath: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && !(key === "page" && value === 1))
      search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${basePath}?${query}` : basePath
}
