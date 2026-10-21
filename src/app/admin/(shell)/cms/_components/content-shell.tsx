"use client"

import {
  ExternalLinkIcon,
  MonitorIcon,
  RefreshCwIcon,
  SmartphoneIcon,
} from "lucide-react"
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type {
  ContentTarget,
  EditorState,
  RevisionSummary,
  WorkflowStatus,
} from "@/features/cms"
import {
  changePageSlugAction,
  changePostSlugAction,
  pageAction,
  postAction,
  previewLinkAction,
  renamePageAction,
  restoreRevisionAction,
  transitionAction,
  type PageAction,
  type Transition,
} from "@/features/cms/admin-actions"
import { cn } from "@/lib/utils"

import { LabelsProvider, type Option } from "./labels"
import type { EditorContext, SaveState } from "./use-autosave"

export type CmsPermissions = {
  draft: boolean
  review: boolean
  publish: boolean
  archive: boolean
}

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: "Draft",
  in_review: "Waiting for review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
}

const ist = (date: Date | string) =>
  new Date(date).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })

function saveText(save: SaveState): string {
  switch (save.kind) {
    case "saved":
      return save.at
        ? `Saved ${save.at.toLocaleTimeString("en-IN", { timeStyle: "short" })}`
        : "All changes saved"
    case "pending":
      return "Unsaved changes…"
    case "saving":
      return "Saving…"
    case "invalid":
      return `Not saved: ${save.count} field${save.count === 1 ? "" : "s"} to fix`
    case "conflict":
    case "error":
      return save.message
  }
}

export type EditorLabels = {
  media: { id: string; key: string; alt: string }[]
  products: Option[]
  collections: Option[]
  categories: Option[]
  pages: Option[]
}

/**
 * Everything around a CMS editor (doc/06 Phase 6): status, workflow buttons,
 * save state, preview and history. Pages, menus and site settings plug
 * their own editor in.
 */
export function ContentShell({
  target,
  state,
  revisions,
  permissions,
  labels,
  noun,
  editor,
}: {
  target: ContentTarget
  state: EditorState
  revisions: RevisionSummary[]
  permissions: CmsPermissions
  labels: EditorLabels
  /** "page", "menu" or "settings", for messages. */
  noun: string
  editor: (context: EditorContext) => ReactNode
}) {
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: null })
  const [revisionId, setRevisionId] = useState(state.draft?.revisionId ?? null)
  const [savedAt, setSavedAt] = useState(state.draft?.updatedAt ?? "")
  const [tab, setTab] = useState<"preview" | "history">("preview")

  // Autosave may have started a new draft since the page loaded.
  const startedDraft =
    revisionId !== null && revisionId !== state.draft?.revisionId
  const status: WorkflowStatus | null = startedDraft
    ? "draft"
    : (state.draft?.status ?? null)
  const frozen =
    status === "in_review" || status === "approved" || status === "scheduled"
  const readOnly =
    !permissions.draft ||
    (state.page ?? state.post)?.status === "archived" ||
    frozen
  const busy = save.kind === "saving" || save.kind === "pending"
  const hasChanges =
    startedDraft ||
    (status !== null &&
      ["draft", "in_review", "approved", "scheduled"].includes(status))

  const onSaved = useCallback(
    (base: { revisionId: string; updatedAt: string }) => {
      setRevisionId(base.revisionId)
      setSavedAt(base.updatedAt)
    },
    [],
  )

  return (
    <LabelsProvider initial={labels}>
      <div className="flex flex-col gap-4">
        <WorkflowBar
          target={target}
          state={state}
          status={status}
          previewId={revisionId}
          permissions={permissions}
          save={save}
          busy={busy}
          hasChanges={hasChanges}
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-3">
            <p
              aria-live="polite"
              className={cn(
                "text-sm",
                save.kind === "conflict" ||
                  save.kind === "error" ||
                  save.kind === "invalid"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {readOnly && permissions.draft && frozen
                ? "This version is locked while it waits. Withdraw it or cancel the schedule to edit."
                : readOnly && !permissions.draft
                  ? `You can view this ${noun} but not edit it.`
                  : saveText(save)}
              {save.kind === "conflict" && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="ml-2 underline"
                >
                  Reload
                </button>
              )}
            </p>
            <Fragment key={state.draft?.updatedAt ?? "new"}>
              {editor({ readOnly, onSaved, onSaveState: setSave })}
            </Fragment>
          </div>
          <div className="flex flex-col gap-3">
            <div role="tablist" aria-label="Side panel" className="flex gap-2">
              {(["preview", "history"] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={cn(
                    "rounded-sm border px-3 py-1 text-sm",
                    tab === value ? "border-ink bg-ink text-paper" : "bg-card",
                  )}
                >
                  {value === "preview"
                    ? "Preview"
                    : `History (${revisions.length})`}
                </button>
              ))}
            </div>
            {tab === "preview" ? (
              <PreviewPane revisionId={revisionId} version={savedAt} />
            ) : (
              <History
                target={target}
                revisions={revisions}
                canRestore={
                  permissions.draft &&
                  (state.page ?? state.post)?.status !== "archived"
                }
              />
            )}
          </div>
        </div>
      </div>
    </LabelsProvider>
  )
}

// --- Workflow bar ----------------------------------------------------------------------

function WorkflowBar({
  target,
  state,
  status,
  previewId,
  permissions,
  save,
  busy,
  hasChanges,
}: {
  target: ContentTarget
  state: EditorState
  status: WorkflowStatus | null
  previewId: string | null
  permissions: CmsPermissions
  save: SaveState
  busy: boolean
  hasChanges: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [dialog, setDialog] = useState<
    null | "schedule" | "send-back" | "submit"
  >(null)
  const page = state.page
  // Pages and posts can be renamed in address, taken offline and archived.
  const item = state.page ?? state.post
  const what = state.post ? "story" : "page"
  const isHome = page?.type === "home"
  const archived = item?.status === "archived"
  const live = item ? item.status === "published" : !!state.publishedRevisionId
  const blocked =
    pending || busy || save.kind === "invalid" || save.kind === "conflict"

  const run = (kind: Transition, input: object, done: string) =>
    startTransition(async () => {
      const result = await transitionAction(kind, {
        target,
        ...input,
      } as never)
      if (result.ok) {
        toast.success(done)
        setDialog(null)
      } else toast.error(result.message)
    })
  const runPage = (kind: PageAction, done: string) =>
    startTransition(async () => {
      if (!item) return
      const result = state.post
        ? await postAction(kind, item.id)
        : await pageAction(kind, item.id)
      if (result.ok) toast.success(done)
      else toast.error(result.message)
    })

  const openPreview = () =>
    startTransition(async () => {
      if (!previewId) return
      const result = await previewLinkAction({ revisionId: previewId })
      if (result.ok) window.open(result.path, "_blank", "noopener")
      else toast.error(result.message)
    })

  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-sm border bg-card p-3 lg:top-0">
      <StatusBadge tone={live ? "good" : archived ? "neutral" : "warn"}>
        {live ? "Live" : archived ? "Archived" : "Not live"}
      </StatusBadge>
      {status && status !== "published" && status !== "archived" && (
        <StatusBadge tone={status === "in_review" ? "info" : "warn"}>
          {status === "scheduled" && state.draft?.scheduledFor
            ? `Scheduled for ${ist(state.draft.scheduledFor)}`
            : status === "draft"
              ? "Unpublished changes"
              : STATUS_LABEL[status]}
        </StatusBadge>
      )}
      {status === "draft" && state.draft?.reviewNote && (
        <span className="text-sm text-destructive">
          Sent back: {state.draft.reviewNote}
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        {previewId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm"
            onClick={openPreview}
            disabled={pending}
          >
            <ExternalLinkIcon className="size-4" aria-hidden /> Preview
          </Button>
        )}
        {page && permissions.draft && !archived && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            disabled={pending}
            onClick={() => {
              const title = window.prompt("Page name", page.title)?.trim()
              if (!title || title === page.title) return
              startTransition(async () => {
                const result = await renamePageAction({
                  pageId: page.id,
                  title,
                })
                if (result.ok) toast.success("Renamed")
                else toast.error(result.message)
              })
            }}
          >
            Rename
          </Button>
        )}
        {item && !isHome && permissions.publish && !archived && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            disabled={pending}
            onClick={() => {
              const slug = window
                .prompt(
                  item.publishedAt
                    ? "New web address (the old one will redirect here)"
                    : "New web address",
                  item.slug,
                )
                ?.trim()
                .toLowerCase()
              if (!slug || slug === item.slug) return
              startTransition(async () => {
                const result = state.post
                  ? await changePostSlugAction({ postId: item.id, slug })
                  : await changePageSlugAction({ pageId: item.id, slug })
                if (result.ok) toast.success("Address changed")
                else
                  toast.error(result.fieldErrors?.slug?.[0] ?? result.message)
              })
            }}
          >
            Change address
          </Button>
        )}
        {status === "in_review" && permissions.draft && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm"
            disabled={pending}
            onClick={() => run("withdraw", {}, "Withdrawn: you can edit again")}
          >
            Withdraw
          </Button>
        )}
        {status === "in_review" && permissions.review && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm"
            disabled={pending}
            onClick={() => setDialog("send-back")}
          >
            Send back
          </Button>
        )}
        {status === "scheduled" && permissions.publish && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-sm"
            disabled={pending}
            onClick={() => run("cancelSchedule", {}, "Schedule cancelled")}
          >
            Cancel schedule
          </Button>
        )}
        {status === "draft" && !permissions.publish && permissions.draft && (
          <Button
            type="button"
            size="sm"
            className="rounded-sm"
            disabled={blocked || !hasChanges}
            onClick={() => setDialog("submit")}
          >
            Submit for review
          </Button>
        )}
        {permissions.publish && !archived && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-sm"
              disabled={blocked || !hasChanges}
              onClick={() => setDialog("schedule")}
            >
              Schedule
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-sm"
              disabled={blocked || (!hasChanges && live) || !previewId}
              onClick={() =>
                run("publish", {}, "Published: live within seconds")
              }
            >
              Publish
            </Button>
          </>
        )}
        {item && permissions.publish && live && !isHome && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Take this ${what} off the site?`))
                runPage("unpublish", "Unpublished")
            }}
          >
            Unpublish
          </Button>
        )}
        {item && permissions.archive && !isHome && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="rounded-sm"
            disabled={pending}
            onClick={() =>
              archived
                ? runPage("restore", "Restored as a draft")
                : window.confirm(`Archive this ${what}? It goes offline.`) &&
                  runPage("archive", "Archived")
            }
          >
            {archived ? "Restore" : "Archive"}
          </Button>
        )}
      </div>

      <NoteDialog
        open={dialog === "submit"}
        title="Submit for review"
        description="A Content Manager will publish it or send it back."
        label="Note for the reviewer (optional)"
        required={false}
        action="Submit"
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(note) =>
          run("submit", note ? { note } : {}, "Submitted for review")
        }
      />
      <NoteDialog
        open={dialog === "send-back"}
        title="Send back for changes"
        description="The author sees your note above the editor."
        label="What needs changing"
        required
        action="Send back"
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(reviewNote) =>
          run("requestChanges", { reviewNote }, "Sent back")
        }
      />
      <ScheduleDialog
        open={dialog === "schedule"}
        pending={pending}
        onClose={() => setDialog(null)}
        onSubmit={(at) => run("schedule", { at }, `Scheduled for ${ist(at)}`)}
      />
    </div>
  )
}

function NoteDialog({
  open,
  title,
  description,
  label,
  required,
  action,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  description: string
  label: string
  required: boolean
  action: string
  pending: boolean
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState("")
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit(note.trim())
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{label}</span>
            <textarea
              value={note}
              required={required}
              maxLength={500}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-sm border bg-card p-2"
            />
          </label>
          <Button
            type="submit"
            className="self-end rounded-sm"
            disabled={pending}
          >
            {action}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Date and time are entered in IST, whatever the browser's zone. */
function ScheduleDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean
  pending: boolean
  onClose: () => void
  onSubmit: (at: string) => void
}) {
  const [value, setValue] = useState("")
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>Schedule publishing</DialogTitle>
          <DialogDescription>
            It goes live within a minute of this time (India time, IST).
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (value) onSubmit(`${value}:00+05:30`)
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Date and time (IST)</span>
            <input
              type="datetime-local"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="h-9 rounded-sm border bg-card px-2"
            />
          </label>
          <Button
            type="submit"
            className="self-end rounded-sm"
            disabled={pending}
          >
            Schedule
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Preview pane ----------------------------------------------------------------------

const WIDTHS = { desktop: 1280, mobile: 390 } as const

function PreviewPane({
  revisionId,
  version,
}: {
  revisionId: string | null
  version: string
}) {
  const [device, setDevice] = useState<keyof typeof WIDTHS>("desktop")
  const [path, setPath] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!revisionId) return
    let cancelled = false
    void previewLinkAction({ revisionId }).then((result) => {
      if (!cancelled && result.ok) setPath(result.path)
    })
    return () => {
      cancelled = true
    }
  }, [revisionId])

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? WIDTHS[device]
      setScale(Math.min(1, width / WIDTHS[device]))
    })
    observer.observe(element)
    return () => observer.disconnect()
    // The frame mounts once the preview link has loaded.
  }, [device, path])

  if (!revisionId || !path) {
    return (
      <p className="rounded-sm border border-dashed p-6 text-sm text-muted-foreground">
        The preview appears once the page has been saved.
      </p>
    )
  }
  const width = WIDTHS[device]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Preview size" className="flex gap-1">
          {(["desktop", "mobile"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={device === value}
              onClick={() => setDevice(value)}
              className={cn(
                "flex items-center gap-1 rounded-sm border px-2 py-1 text-xs",
                device === value ? "border-ink bg-ink text-paper" : "bg-card",
              )}
            >
              {value === "desktop" ? (
                <MonitorIcon className="size-3.5" aria-hidden />
              ) : (
                <SmartphoneIcon className="size-3.5" aria-hidden />
              )}
              {value === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setReloads((n) => n + 1)}
          className="ml-auto flex items-center gap-1 text-xs underline"
        >
          <RefreshCwIcon className="size-3.5" aria-hidden /> Refresh
        </button>
        <a
          href={path}
          target="_blank"
          rel="noopener"
          className="flex items-center gap-1 text-xs underline"
        >
          <ExternalLinkIcon className="size-3.5" aria-hidden /> Open
        </a>
      </div>
      <div
        ref={frame}
        className="overflow-hidden rounded-sm border bg-secondary"
        style={{ height: 720 }}
      >
        <iframe
          key={`${version}-${reloads}-${device}`}
          title="Page preview"
          src={path}
          style={{
            width,
            height: 720 / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          className={cn("bg-paper", device === "mobile" && "mx-auto")}
        />
      </div>
    </div>
  )
}

// --- History ---------------------------------------------------------------------------

function History({
  target,
  revisions,
  canRestore,
}: {
  target: ContentTarget
  revisions: RevisionSummary[]
  canRestore: boolean
}) {
  const [pending, startTransition] = useTransition()
  return (
    <ol className="flex flex-col divide-y rounded-sm border bg-card text-sm">
      {revisions.map((revision) => (
        <li key={revision.id} className="flex flex-col gap-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Version {revision.version}</span>
            <StatusBadge
              tone={
                revision.live
                  ? "good"
                  : revision.status === "in_review"
                    ? "info"
                    : revision.status === "archived"
                      ? "neutral"
                      : "warn"
              }
            >
              {revision.live ? "Live" : STATUS_LABEL[revision.status]}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              {ist(revision.publishedAt ?? revision.updatedAt)}
            </span>
          </div>
          <p>{revision.changes}</p>
          <p className="text-xs text-muted-foreground">
            {[
              revision.author && `By ${revision.author}`,
              revision.publisher && `published by ${revision.publisher}`,
              revision.scheduledFor &&
                revision.status === "scheduled" &&
                `for ${ist(revision.scheduledFor)}`,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
          {revision.note && <p className="text-xs">Note: {revision.note}</p>}
          {revision.reviewNote && (
            <p className="text-xs text-destructive">
              Sent back: {revision.reviewNote}
            </p>
          )}
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="underline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await previewLinkAction({
                    revisionId: revision.id,
                  })
                  if (result.ok) window.open(result.path, "_blank", "noopener")
                  else toast.error(result.message)
                })
              }
            >
              Preview
            </button>
            {canRestore && (
              <button
                type="button"
                className="underline"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Copy version ${revision.version} into the draft? Unsaved edits are replaced.`,
                    )
                  )
                    return
                  startTransition(async () => {
                    const result = await restoreRevisionAction({
                      target,
                      revisionId: revision.id,
                    })
                    if (result.ok)
                      toast.success(
                        `Version ${revision.version} copied into the draft`,
                      )
                    else toast.error(result.message)
                  })
                }}
              >
                Restore
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
