"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { ContentTarget, EditorState } from "@/features/cms"
import { autosaveAction } from "@/features/cms/admin-actions"

export type SaveState =
  | { kind: "saved"; at: Date | null }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "invalid"; count: number }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string }

/** What every content editor gets from the shell. */
export type EditorContext = {
  readOnly: boolean
  onSaved: (base: { revisionId: string; updatedAt: string }) => void
  onSaveState: (save: SaveState) => void
}

type Base = { revisionId: string; updatedAt: string } | null

/**
 * Autosave for any CMS content (doc/06 Phase 6): about 1.5 seconds after a
 * valid change, the working draft is saved with the token it was loaded
 * with; edits made during a save go next. Invalid content is not saved.
 */
export function useAutosave<T>({
  target,
  state,
  errorCount,
  context,
}: {
  target: ContentTarget
  state: Pick<EditorState<T>, "data" | "draft">
  errorCount: (data: T) => number
  context: EditorContext
}) {
  const { readOnly, onSaved, onSaveState } = context
  const [data, setData] = useState<T>(state.data)
  const base = useRef<Base>(
    state.draft
      ? { revisionId: state.draft.revisionId, updatedAt: state.draft.updatedAt }
      : null,
  )
  const latest = useRef(data)
  const saving = useRef(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetKey = JSON.stringify(target)

  const save = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    try {
      while (dirty.current) {
        const snapshot = latest.current
        if (errorCount(snapshot) > 0) return
        dirty.current = false
        onSaveState({ kind: "saving" })
        const result = await autosaveAction({
          target: JSON.parse(targetKey) as ContentTarget,
          data: snapshot,
          base: base.current,
        })
        if (!result.ok) {
          dirty.current = true
          onSaveState(
            result.code === "CONFLICT"
              ? { kind: "conflict", message: result.message }
              : { kind: "error", message: result.message },
          )
          return
        }
        base.current = {
          revisionId: result.revisionId,
          updatedAt: result.updatedAt,
        }
        onSaved(base.current)
      }
      onSaveState({ kind: "saved", at: new Date() })
    } finally {
      saving.current = false
    }
  }, [errorCount, onSaveState, onSaved, targetKey])

  const update = (next: T) => {
    if (readOnly) return
    setData(next)
    latest.current = next
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    const count = errorCount(next)
    if (count > 0) {
      onSaveState({ kind: "invalid", count })
      return
    }
    onSaveState({ kind: "pending" })
    timer.current = setTimeout(() => void save(), 1_500)
  }

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  return { data, update }
}

/** Groups schema issues by their first path segment(s) for display. */
export function issueCount(groups: Record<string, Record<string, string>>) {
  return Object.values(groups).reduce(
    (n, group) => n + Object.keys(group).length,
    0,
  )
}
