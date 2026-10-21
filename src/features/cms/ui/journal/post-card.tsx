import type { Route } from "next"
import Link from "next/link"

import { MediaImage } from "@/components/media-image"

import type { JournalCard } from "@/features/cms/journal"

export const journalDate = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })

/** A post in a list: cover, category, title, excerpt and byline. */
export function PostCard({
  post,
  large = false,
  preload = false,
}: {
  post: JournalCard
  large?: boolean
  preload?: boolean
}) {
  const href = `/journal/${post.slug}` as Route
  return (
    <article
      className={large ? "grid gap-6 md:grid-cols-2 md:items-center" : ""}
    >
      <Link href={href} className="group block overflow-hidden bg-secondary">
        <span className="relative block aspect-[4/3]">
          {post.cover && (
            <MediaImage
              media={post.cover}
              alt=""
              fill
              preload={preload}
              sizes={
                large
                  ? "(min-width: 768px) 50vw, 100vw"
                  : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              }
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          )}
        </span>
      </Link>
      <div className={large ? "" : "mt-3"}>
        {post.category && (
          <Link
            href={`/journal/category/${post.category.slug}` as Route}
            className="text-xs font-semibold tracking-wider text-rust uppercase hover:underline"
          >
            {post.category.name}
          </Link>
        )}
        <h2
          className={
            large
              ? "mt-2 display-heading text-4xl sm:text-5xl"
              : "mt-1 text-xl font-semibold"
          }
        >
          <Link href={href} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        {post.excerpt && (
          <p className="mt-2 text-muted-foreground">{post.excerpt}</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {post.author && <>{post.author.name} · </>}
          <time dateTime={post.publishedAt.toISOString()}>
            {journalDate(post.publishedAt)}
          </time>{" "}
          · {post.readingMinutes} min read
        </p>
      </div>
    </article>
  )
}
