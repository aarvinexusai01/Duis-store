import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { CmsPageView, cmsPageMetadata } from "@/features/cms/ui/cms-page"

export async function generateMetadata({
  params,
}: PageProps<"/policies/[slug]">) {
  return cmsPageMetadata((await params).slug)
}

export default function Page({ params }: PageProps<"/policies/[slug]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Resolved params={params} />
    </Suspense>
  )
}

async function Resolved({
  params,
}: Pick<PageProps<"/policies/[slug]">, "params">) {
  const { slug } = await params
  return <CmsPageView slug={slug} path={`/policies/${slug}`} />
}
