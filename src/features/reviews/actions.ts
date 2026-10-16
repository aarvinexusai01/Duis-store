"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { moderateReview, submitReview } from "./service"

type Result<T = object> = ({ ok: true } & T) | ({ ok: false } & ActionError)

async function run<T extends object>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    const value = await work()
    refresh()
    return { ok: true, ...value }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

type Input<F extends (actor: never, input: never) => unknown> = Parameters<F>[1]

export async function submitReviewAction(input: Input<typeof submitReview>) {
  return run(async () => submitReview(await getActor(), input))
}

export async function moderateReviewAction(
  input: Input<typeof moderateReview>,
) {
  return run(async () => moderateReview(await getActor(), input))
}
