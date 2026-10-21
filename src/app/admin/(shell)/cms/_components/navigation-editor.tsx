"use client"

import type {
  EditorState,
  MenuKey,
  NavigationData,
  RevisionSummary,
} from "@/features/cms"

import {
  ContentShell,
  type CmsPermissions,
  type EditorLabels,
} from "./content-shell"
import { NavBuilder } from "./nav-builder"

export function NavigationEditor({
  menuKey,
  state,
  revisions,
  permissions,
  labels,
}: {
  menuKey: MenuKey
  state: EditorState<NavigationData>
  revisions: RevisionSummary[]
  permissions: CmsPermissions
  labels: EditorLabels
}) {
  return (
    <ContentShell
      target={{ type: "navigation", key: menuKey }}
      state={state}
      revisions={revisions}
      permissions={permissions}
      labels={labels}
      noun="menu"
      editor={(context) => (
        <NavBuilder menuKey={menuKey} state={state} context={context} />
      )}
    />
  )
}
