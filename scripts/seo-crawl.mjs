// Crawls the storefront like a search engine and reports what would hurt it
// in search (Phase 11): broken pages, redirect chains, orphan pages (in the
// sitemap but linked from nowhere), missing or duplicate titles and
// descriptions, H1 problems and structured data that doesn't parse.
//   node scripts/seo-crawl.mjs [https://theduis.com] [--max 600]
// It follows links on the site's own host only, skips URLs robots.txt keeps
// private (bag, account, search…), and exits 1 if it finds errors.

const args = process.argv.slice(2)
const base = new URL(
  args.find((a) => a.startsWith("http")) ?? "https://theduis.com",
)
const max = Number(args[args.indexOf("--max") + 1]) || 600
// cdn-cgi: Cloudflare's own paths (e.g. its email-obfuscation links).
const PRIVATE =
  /^\/(account|cart|checkout|wishlist|search|login|register|auth|api|admin|newsletter|preview|track|_next|media|brand|cdn-cgi)(\/|$)/

const errors = []
const warnings = []
const pages = new Map() // path → { title, description, h1, status }
const linkedFrom = new Map() // path → first page linking to it

function normalise(href, from) {
  try {
    const url = new URL(href, from)
    if (url.host !== base.host || !/^https?:$/.test(url.protocol)) return null
    if (PRIVATE.test(url.pathname)) return null
    // Filter and sort variants are noindex by design; crawl the plain page.
    if (url.search && !/^\?page=\d+$/.test(url.search)) return null
    return url.pathname + url.search
  } catch {
    return null
  }
}

async function fetchManual(url) {
  return fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "DuisSEOCrawl/1.0 (+https://theduis.com)" },
  })
}

/** Follows redirects itself, so chains are visible. */
async function load(path) {
  let url = new URL(path, base).toString()
  const hops = []
  for (let i = 0; i < 6; i += 1) {
    const response = await fetchManual(url)
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location"), url).toString()
      hops.push(`${response.status} ${new URL(url).pathname}`)
      url = next
      continue
    }
    return { response, hops, finalUrl: url }
  }
  return { response: null, hops, finalUrl: url }
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#x27": "'",
  "#39": "'",
}
const decode = (text) =>
  text?.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name) => ENTITIES[name])
const textOf = (html, re) => decode((html.match(re) ?? [])[1]?.trim())

async function crawl() {
  const queue = ["/"]
  const seen = new Set(queue)
  while (queue.length > 0 && pages.size < max) {
    const batch = queue.splice(0, 8)
    await Promise.all(
      batch.map(async (path) => {
        const { response, hops, finalUrl } = await load(path)
        if (!response) {
          errors.push(`${path}: more than 5 redirects`)
          return
        }
        if (hops.length > 1)
          warnings.push(
            `${path}: redirect chain ${hops.join(" → ")} → ${new URL(finalUrl).pathname}`,
          )
        if (hops.length > 0 && linkedFrom.has(path)) {
          warnings.push(
            `${path}: linked from ${linkedFrom.get(path)} but redirects (link to ${new URL(finalUrl).pathname} instead)`,
          )
        }
        if (response.status !== 200) {
          errors.push(
            `${path}: HTTP ${response.status}${linkedFrom.has(path) ? ` (linked from ${linkedFrom.get(path)})` : ""}`,
          )
          return
        }
        // A redirected URL is the same page as its target: record it once.
        const finalPath = new URL(finalUrl).pathname + new URL(finalUrl).search
        if (hops.length > 0 && (seen.has(finalPath) || pages.has(finalPath)))
          return
        if (hops.length > 0) seen.add(finalPath)
        const html = await response.text()
        const robots =
          textOf(html, /<meta name="robots" content="([^"]*)"/) ?? ""
        const page = {
          title: textOf(html, /<title>([^<]*)<\/title>/),
          description: textOf(
            html,
            /<meta name="description" content="([^"]*)"/,
          ),
          h1: (html.match(/<h1[\s>]/g) ?? []).length,
          noindex: robots.includes("noindex"),
        }
        pages.set(hops.length > 0 ? finalPath : path, page)
        for (const block of html.matchAll(
          /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
        )) {
          try {
            JSON.parse(block[1])
          } catch {
            errors.push(`${path}: structured data that isn't valid JSON`)
          }
        }
        for (const match of html.matchAll(/<a [^>]*href="([^"#]+)"/g)) {
          const next = normalise(
            match[1].replace(/&amp;/g, "&"),
            new URL(path, base),
          )
          if (!next) continue
          if (!linkedFrom.has(next)) linkedFrom.set(next, path)
          if (!seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
        }
      }),
    )
  }
}

async function sitemapPaths() {
  const xml = await (await fetch(new URL("/sitemap.xml", base))).text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  )
}

await crawl()
const sitemap = await sitemapPaths()

for (const path of sitemap) {
  if (!linkedFrom.has(path) && path !== "/")
    warnings.push(
      `${path}: orphan (in the sitemap, linked from no crawled page)`,
    )
}
const indexable = [...pages].filter(([, p]) => !p.noindex)
for (const [path, page] of indexable) {
  if (!page.title) errors.push(`${path}: no <title>`)
  else if (page.title.length > 65)
    warnings.push(
      `${path}: title ${page.title.length} chars (cut off in results): ${page.title}`,
    )
  else if (page.title.length < 25)
    warnings.push(
      `${path}: title only ${page.title.length} chars: ${page.title}`,
    )
  if (!page.description) warnings.push(`${path}: no meta description`)
  if (page.h1 !== 1) warnings.push(`${path}: ${page.h1} <h1> elements`)
}
for (const field of ["title", "description"]) {
  const by = new Map()
  for (const [path, page] of indexable) {
    if (!page[field]) continue
    by.set(page[field], [...(by.get(page[field]) ?? []), path])
  }
  for (const [value, paths] of by) {
    if (paths.length > 1)
      warnings.push(
        `${paths.length} pages share the ${field} "${value.slice(0, 60)}": ${paths.slice(0, 4).join(", ")}`,
      )
  }
}

console.log(
  `Crawled ${pages.size} pages from ${base.origin} (${indexable.length} indexable); sitemap lists ${sitemap.length}.`,
)
for (const line of errors) console.log(`  ERROR  ${line}`)
for (const line of warnings) console.log(`  warn   ${line}`)
if (errors.length === 0 && warnings.length === 0)
  console.log("  No problems found.")
process.exitCode = errors.length > 0 ? 1 : 0
