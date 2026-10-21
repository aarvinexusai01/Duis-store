import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  editorLabelsFor,
  getEditor,
  getJournalTaxonomy,
  listRevisions,
  type BlogPostData,
  type EditorState,
} from "@/features/cms"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"

import { PostEditor } from "../../_components/post-editor"

export const metadata: Metadata = { title: "Edit story" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Props = PageProps<"/admin/cms/journal/[id]">

export default function EditPostPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Editor params={params} />
    </Suspense>
  )
}

async function Editor({ params }: Pick<Props, "params">) {
  const { id } = await params
  const actor = await requireStaff(`/admin/cms/journal/${id}`)
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  if (!UUID.test(id)) notFound()
  const target = { type: "blog_post" as const, id }
  const state = (await getEditor(actor, { target }).catch((error: unknown) => {
    if (isDomainError(error)) notFound()
    throw error
  })) as EditorState<BlogPostData>
  const [revisions, labels, taxonomy] = await Promise.all([
    listRevisions(actor, { target }),
    editorLabelsFor("blog_post", state.data),
    getJournalTaxonomy(actor, {}),
  ])
  return (
    <>
      <AdminPageHeader
        title={state.data.title || "Untitled story"}
        back={{ href: "/admin/cms/journal", label: "Journal" }}
        description={`/journal/${state.post?.slug ?? ""}`}
      />
      <PostEditor
        postId={id}
        state={state}
        revisions={revisions}
        labels={labels}
        authors={taxonomy.authors.map((a) => ({ id: a.id, label: a.name }))}
        categories={taxonomy.categories.map((c) => ({
          id: c.id,
          label: c.name,
        }))}
        tags={taxonomy.tags.map((t) => ({ id: t.id, label: t.name }))}
        permissions={{
          draft: can(actor, { cms: ["draft"] }),
          review: can(actor, { cms: ["review"] }),
          publish: can(actor, { cms: ["publish"] }),
          archive: can(actor, { cms: ["archive"] }),
        }}
      />
    </>
  )
}
