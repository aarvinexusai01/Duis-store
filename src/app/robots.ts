import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { getServerEnv } from "@/config/env"
import { absoluteUrl } from "@/server/site-url"

/** Never useful in search results: personal, transactional or duplicate. */
const PRIVATE = [
  "/account",
  "/cart",
  "/checkout",
  "/wishlist",
  "/search",
  "/login",
  "/register",
  "/auth/",
  "/api/",
  "/admin",
  "/newsletter/",
  "/preview/",
  "/track/",
]

/** Assistants that fetch pages to answer a person's question, with links. */
const AI_SEARCH = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "DuckAssistBot",
]

/** Crawlers that collect content for training models. */
const AI_TRAINING = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
  "cohere-ai",
  "Diffbot",
]

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  // Only production is indexable; staging and development ask crawlers to stay out.
  if (getServerEnv().APP_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } }
  }
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // AI search and answer assistants may read the shop, so shoppers asking
      // them for products can be shown Duis (owner decision 2026-10-30)...
      { userAgent: AI_SEARCH, allow: "/", disallow: PRIVATE },
      // ...but the content may not be used to train AI models.
      { userAgent: AI_TRAINING, disallow: "/" },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
