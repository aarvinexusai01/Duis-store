"use client"

import type { PageEditorState, RevisionSummary } from "@/features/cms"

import {
  ContentShell,
  type CmsPermissions,
  type EditorLabels,
} from "./content-shell"
import { PageBuilder } from "./page-builder"

export function PageEditor({
  state,
  revisions,
  permissions,
  labels,
}: {
  state: PageEditorState
  revisions: RevisionSummary[]
  permissions: CmsPermissions
  labels: EditorLabels
}) {
  return (
    <ContentShell
      target={{ type: "page", id: state.page.id }}
      state={state}
      revisions={revisions}
      permissions={permissions}
      labels={labels}
      noun="page"
      editor={(context) => <PageBuilder state={state} context={context} />}
    />
  )
}
