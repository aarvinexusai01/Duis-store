"use client"

import type {
  EditorState,
  RevisionSummary,
  SiteSettingsData,
} from "@/features/cms"

import {
  ContentShell,
  type CmsPermissions,
  type EditorLabels,
} from "./content-shell"
import { SettingsForm } from "./settings-form"

export function SiteSettingsEditor({
  state,
  revisions,
  permissions,
  labels,
}: {
  state: EditorState<SiteSettingsData>
  revisions: RevisionSummary[]
  permissions: CmsPermissions
  labels: EditorLabels
}) {
  return (
    <ContentShell
      target={{ type: "site_settings" }}
      state={state}
      revisions={revisions}
      permissions={permissions}
      labels={labels}
      noun="settings"
      editor={(context) => <SettingsForm state={state} context={context} />}
    />
  )
}
