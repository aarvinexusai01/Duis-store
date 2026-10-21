import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import {
  editorLabelsFor,
  getEditor,
  listRevisions,
  type EditorState,
  type SiteSettingsData,
} from "@/features/cms"
import { can, requireStaff } from "@/features/staff"

import { SiteSettingsEditor } from "../_components/site-settings-editor"

export const metadata: Metadata = { title: "Site settings" }

export default function SiteSettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Editor />
    </Suspense>
  )
}

async function Editor() {
  const actor = await requireStaff("/admin/cms/settings")
  if (!can(actor, { cms: ["read"] })) return <NoAccess />
  const target = { type: "site_settings" as const }
  const state = (await getEditor(actor, {
    target,
  })) as EditorState<SiteSettingsData>
  const [revisions, labels] = await Promise.all([
    listRevisions(actor, { target }),
    editorLabelsFor("site_settings", state.data),
  ])
  return (
    <>
      <AdminPageHeader
        title="Site settings"
        description="Brand, announcement bar, contact details, social links and search defaults. Shop rules (shipping, COD, tax) are under Administration → Settings."
      />
      <SiteSettingsEditor
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
