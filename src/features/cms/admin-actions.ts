"use server"

import type { Route } from "next"
import { refresh } from "next/cache"
import { redirect } from "next/navigation"

import { adminListProducts, loadCatalogTree } from "@/features/catalog"
import { adminListCollections } from "@/features/collections"
import { adminListMedia } from "@/features/media"
import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { createPage } from "./service"
import {
  archivePage,
  autosavePageDraft,
  cancelPageSchedule,
  createPreviewLink,
  publishPage,
  renamePage,
  requestPageChanges,
  restorePage,
  restoreRevision,
  schedulePage,
  submitPageForReview,
  unpublishPage,
  withdrawPageSubmission,
} from "./workflow"

export type CmsResult<T = object> =
  ({ ok: true } & T) | ({ ok: false } & ActionError)

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

/** Runs an operation as the signed-in staff member. */
async function run<T extends object>(
  work: () => Promise<T>,
  { refreshPage = true }: { refreshPage?: boolean } = {},
): Promise<CmsResult<T>> {
  try {
    const value = await work()
    if (refreshPage) refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function createPageAction(input: Input<typeof createPage>) {
  let id: string
  try {
    ;({ id } = await createPage(await getActor(), input))
  } catch (error) {
    return { ok: false as const, ...toActionError(error) }
  }
  redirect(`/admin/cms/pages/${id}` as Route)
}

/** Autosave: no page refresh, so the editor keeps its state. */
export async function autosavePageAction(
  input: Input<typeof autosavePageDraft>,
) {
  return run(async () => autosavePageDraft(await getActor(), input), {
    refreshPage: false,
  })
}

export async function renamePageAction(input: Input<typeof renamePage>) {
  return run(async () => renamePage(await getActor(), input))
}

const transitions = {
  submit: submitPageForReview,
  withdraw: withdrawPageSubmission,
  requestChanges: requestPageChanges,
  publish: publishPage,
  schedule: schedulePage,
  cancelSchedule: cancelPageSchedule,
  unpublish: unpublishPage,
  archive: archivePage,
  restore: restorePage,
} as const

export type PageTransition = keyof typeof transitions

export async function pageTransitionAction<K extends PageTransition>(
  kind: K,
  input: Input<(typeof transitions)[K]>,
) {
  const operation = transitions[kind] as unknown as (
    actor: Awaited<ReturnType<typeof getActor>>,
    input: unknown,
  ) => Promise<object>
  return run(async () => operation(await getActor(), input))
}

export async function restoreRevisionAction(
  input: Input<typeof restoreRevision>,
) {
  return run(async () => restoreRevision(await getActor(), input))
}

export async function previewLinkAction(
  input: Input<typeof createPreviewLink>,
) {
  return run(async () => createPreviewLink(await getActor(), input), {
    refreshPage: false,
  })
}

// --- Pickers ---------------------------------------------------------------------------

export async function searchMediaAction(input: Input<typeof adminListMedia>) {
  return run(async () => adminListMedia(await getActor(), input), {
    refreshPage: false,
  })
}

export async function searchProductsAction(q: string) {
  return run(
    async () => {
      const { rows } = await adminListProducts(await getActor(), {
        q: q.trim().slice(0, 100) || undefined,
        status: "active",
        page: 1,
      })
      return {
        items: rows.slice(0, 20).map((p) => ({
          id: p.id,
          label: p.title,
          imageKey: p.imageKey,
        })),
      }
    },
    { refreshPage: false },
  )
}

export async function pickerOptionsAction() {
  return run(
    async () => {
      const actor = await getActor()
      const [collections, tree] = await Promise.all([
        adminListCollections(actor, {}),
        loadCatalogTree(),
      ])
      return {
        collections: collections
          .filter((c) => c.status !== "archived")
          .map((c) => ({
            id: c.id,
            label: c.status === "published" ? c.title : `${c.title} (draft)`,
          })),
        categories: tree.categories.map((c) => ({
          id: c.id,
          label: `${"– ".repeat(c.depth)}${c.name}`,
        })),
      }
    },
    { refreshPage: false },
  )
}
