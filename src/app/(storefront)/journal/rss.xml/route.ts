import { connection } from "next/server"

import { SITE } from "@/config/site"
import { getJournalFeed } from "@/features/cms/queries"
import { absoluteUrl } from "@/server/site-url"
import { mediaSrc } from "@/lib/image-loader"

const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")

/** RSS 2.0 for the Journal (doc/06 Phase 6c): the latest 30 stories. */
export async function GET() {
  await connection()
  const posts = await getJournalFeed()
  const home = absoluteUrl("/journal")
  const items = posts
    .map((post) => {
      const link = absoluteUrl(`/journal/${post.slug}`)
      return [
        "<item>",
        `<title>${xml(post.title)}</title>`,
        `<link>${xml(link)}</link>`,
        `<guid isPermaLink="true">${xml(link)}</guid>`,
        `<pubDate>${post.publishedAt.toUTCString()}</pubDate>`,
        post.excerpt ? `<description>${xml(post.excerpt)}</description>` : "",
        post.author ? `<dc:creator>${xml(post.author.name)}</dc:creator>` : "",
        post.category ? `<category>${xml(post.category.name)}</category>` : "",
        post.cover
          ? `<enclosure url="${xml(absoluteUrl(mediaSrc(post.cover.key, 1280)))}" type="image/webp" length="0"/>`
          : "",
        "</item>",
      ].join("")
    })
    .join("\n")
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(`${SITE.name} — The Journal`)}</title>
<link>${xml(home)}</link>
<description>Stories, styling notes and the people behind the drops.</description>
<language>en-in</language>
<atom:link href="${xml(absoluteUrl("/journal/rss.xml"))}" rel="self" type="application/rss+xml"/>
${posts[0] ? `<lastBuildDate>${posts[0].publishedAt.toUTCString()}</lastBuildDate>` : ""}
${items}
</channel>
</rss>`
  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  })
}
