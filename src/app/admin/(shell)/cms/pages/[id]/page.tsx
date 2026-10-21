import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  editorLabelsFor,
  getEditor,
  listRevisions,
  pageHref,
  type PageEditorState,
} from "@/features/cms"
import { can, requireStaff } from "@/features/staff"
import { isDomainError } from "@/server/errors"

import { PageEditor } from "../../_components/page-editor"

export const metadata: Metadata = { title: "Edit page" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Props = PageProps<"/admin/cms/pages/[id]">

export default function EditPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Editor params={params} />
    </Suspense>
  )
}

async function Editor({ params }: Pick<Props, "params">) {
  const { id } = await params
  const actor = await requireStaff(`/admin/cms/pages/${id}`)
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  if (!UUID.test(id)) notFound()
  const target = { type: "page" as const, id }
  const state = (await getEditor(actor, { target }).catch((error: unknown) => {
    if (isDomainError(error)) notFound()
    throw error
  })) as PageEditorState
  const [revisions, labels] = await Promise.all([
    listRevisions(actor, { target }),
    editorLabelsFor("page", state.data),
  ])
  const address = state.page.type === "home" ? "/" : pageHref(state.page.slug)

  return (
    <>
      <AdminPageHeader
        title={state.page.title}
        back={{ href: "/admin/cms", label: "Pages" }}
        description={address}
      />
      <PageEditor
        state={state}
        revisions={revisions}
        labels={labels}
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
