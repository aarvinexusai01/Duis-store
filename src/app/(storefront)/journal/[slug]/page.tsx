import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { MediaImage } from "@/components/media-image"
import { PageSkeleton } from "@/components/page-skeleton"
import { SITE } from "@/config/site"
import { getJournalPost } from "@/features/cms/queries"
import { PostBody } from "@/features/cms/ui/journal/post-body"
import { journalDate, PostCard } from "@/features/cms/ui/journal/post-card"
import { absoluteUrl } from "@/server/site-url"

type Props = PageProps<"/journal/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection()
  const found = await getJournalPost((await params).slug)
  if (!found) return { title: "Story not found", robots: { index: false } }
  const { post } = found
  const image = post.ogImage
    ? absoluteUrl(`/media/${post.ogImage.key}/1280.webp`)
    : undefined
  return {
    title: post.seo.title ?? post.title,
    description: post.seo.description ?? post.excerpt ?? undefined,
    alternates: { canonical: post.seo.canonical ?? `/journal/${post.slug}` },
    robots: post.seo.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt ?? undefined,
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: post.author ? [post.author.name] : undefined,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default function PostPage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Post params={params} />
    </Suspense>
  )
}

async function Post({ params }: Pick<Props, "params">) {
  await connection()
  const found = await getJournalPost((await params).slug)
  if (!found) notFound()
  const { post, related } = found
  const url = absoluteUrl(`/journal/${post.slug}`)

  return (
    <article className="pb-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt ?? undefined,
          datePublished: post.publishedAt.toISOString(),
          dateModified: post.updatedAt.toISOString(),
          mainEntityOfPage: url,
          url,
          ...(post.cover
            ? { image: absoluteUrl(`/media/${post.cover.key}/1280.webp`) }
            : {}),
          ...(post.author
            ? {
                author: {
                  "@type": "Person",
                  name: post.author.name,
                  url: absoluteUrl(`/journal/author/${post.author.slug}`),
                },
              }
            : {}),
          publisher: { "@type": "Organization", name: SITE.name },
        }}
      />
      <header className="page-container max-w-3xl pt-6 text-center">
        <Breadcrumbs
          items={[
            { label: "Journal", href: "/journal" },
            ...(post.category
              ? [
                  {
                    label: post.category.name,
                    href: `/journal/category/${post.category.slug}`,
                  },
                ]
              : []),
            { label: post.title, href: `/journal/${post.slug}` },
          ]}
          className="justify-center"
        />
        <h1 className="mt-6 display-heading text-5xl sm:text-6xl">
          {post.title}
        </h1>
        {post.excerpt && (
          <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          {post.author && (
            <>
              By{" "}
              <Link
                href={`/journal/author/${post.author.slug}` as Route}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {post.author.name}
              </Link>{" "}
              ·{" "}
            </>
          )}
          <time dateTime={post.publishedAt.toISOString()}>
            {journalDate(post.publishedAt)}
          </time>{" "}
          · {post.readingMinutes} min read
        </p>
      </header>
      {post.cover && (
        <div className="page-container mt-8 max-w-5xl">
          <span className="relative block aspect-[16/9] overflow-hidden bg-secondary">
            <MediaImage
              media={post.cover}
              fill
              preload
              sizes="(min-width: 1024px) 1024px, 100vw"
              className="object-cover"
            />
          </span>
        </div>
      )}
      <div className="page-container mt-10">
        <PostBody blocks={post.body} />
      </div>
      <footer className="page-container mt-12 max-w-2xl">
        {post.tags.length > 0 && (
          <ul aria-label="Tags" className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <li key={tag.slug}>
                <Link
                  href={`/journal/tag/${tag.slug}` as Route}
                  className="border px-2 py-1 text-xs hover:bg-secondary"
                >
                  #{tag.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {post.authorProfile && (
          <aside className="mt-8 flex gap-4 border-t pt-6">
            {post.authorProfile.photo && (
              <span className="relative block size-16 shrink-0 overflow-hidden rounded-full bg-secondary">
                <MediaImage
                  media={post.authorProfile.photo}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </span>
            )}
            <div>
              <p className="font-semibold">
                <Link
                  href={`/journal/author/${post.authorProfile.slug}` as Route}
                  className="hover:underline"
                >
                  {post.authorProfile.name}
                </Link>
              </p>
              {post.authorProfile.bio && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {post.authorProfile.bio}
                </p>
              )}
            </div>
          </aside>
        )}
      </footer>
      {related.length > 0 && (
        <section
          className="page-container mt-16"
          aria-labelledby="more-stories"
        >
          <h2
            id="more-stories"
            className="font-display text-3xl tracking-wide uppercase"
          >
            More stories
          </h2>
          <ul className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <li key={item.id}>
                <PostCard post={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
