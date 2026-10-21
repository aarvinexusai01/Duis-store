import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  editorLabelsFor,
  getEditor,
  listRevisions,
  type EditorState,
  type NavigationData,
} from "@/features/cms"
import { can, requireStaff } from "@/features/staff"

import { NavigationEditor } from "../../_components/navigation-editor"

export const metadata: Metadata = { title: "Edit menu" }

const NAMES = { header: "Header menu", footer: "Footer menu" } as const

type Props = PageProps<"/admin/cms/navigation/[key]">

export default function EditMenuPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Editor params={params} />
    </Suspense>
  )
}

async function Editor({ params }: Pick<Props, "params">) {
  const { key: raw } = await params
  if (raw !== "header" && raw !== "footer") notFound()
  const key: "header" | "footer" = raw
  const actor = await requireStaff(`/admin/cms/navigation/${key}`)
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const target = { type: "navigation" as const, key }
  const state = (await getEditor(actor, {
    target,
  })) as EditorState<NavigationData>
  const [revisions, labels] = await Promise.all([
    listRevisions(actor, { target }),
    editorLabelsFor("navigation", state.data),
  ])
  return (
    <>
      <AdminPageHeader
        title={NAMES[key]}
        back={{ href: "/admin/cms/navigation", label: "Menus" }}
        description={
          key === "header"
            ? "Top items open a mega menu of columns; a promo image shows beside them."
            : "Each item is a column heading with its links underneath."
        }
      />
      <NavigationEditor
        menuKey={key}
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
