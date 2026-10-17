import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getPageEditor,
  listPageRevisions,
  loadEditorLabels,
  pageHref,
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
  const state = await getPageEditor(actor, { pageId: id }).catch((error) => {
    if (isDomainError(error)) notFound()
    throw error
  })
  const [revisions, labels] = await Promise.all([
    listPageRevisions(actor, { pageId: id }),
    loadEditorLabels(state.data),
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
