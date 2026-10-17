import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { loadPreview } from "@/features/cms"
import { PreviewPageView } from "@/features/cms/ui/preview-page"

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
}

type Props = PageProps<"/preview/[token]">

export default function PreviewRoute({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Preview params={params} />
    </Suspense>
  )
}

async function Preview({ params }: Pick<Props, "params">) {
  await connection()
  const { token } = await params
  const preview = await loadPreview(token)
  if (!preview) {
    return (
      <div className="page-container max-w-xl py-16">
        <h1 className="display-heading text-4xl">Preview link expired</h1>
        <p className="mt-4 text-muted-foreground">
          This link is invalid or older than 24 hours. Open the page in the CMS
          and use Preview again.
        </p>
      </div>
    )
  }
  return <PreviewPageView preview={preview} />
}
