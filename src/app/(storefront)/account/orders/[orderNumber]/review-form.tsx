"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { PhotoPicker } from "@/components/customer/photo-picker"
import { Button } from "@/components/ui/button"
import { submitReviewAction } from "@/features/reviews/actions"

/** A verified buyer's review: stars, fit, words and up to three photos. */
export function ReviewForm({ orderItemId }: { orderItemId: string }) {
  const [rating, setRating] = useState(0)
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [pending, startTransition] = useTransition()

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (rating === 0) return void toast.error("Choose a star rating.")
    const form = new FormData(event.currentTarget)
    const fit = String(form.get("fit") ?? "")
    startTransition(async () => {
      const result = await submitReviewAction({
        orderItemId,
        rating,
        title: String(form.get("title") ?? "") || undefined,
        body: String(form.get("body") ?? ""),
        fit: (fit || undefined) as never,
        photoIds,
      })
      if (result.ok) toast.success("Thanks for your review!")
      else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
      <fieldset>
        <legend className="mb-1">Your rating</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <label key={star} className="cursor-pointer text-2xl leading-none">
              <input
                type="radio"
                name={`rating-${orderItemId}`}
                value={star}
                checked={rating === star}
                onChange={() => setRating(star)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={star <= rating ? "text-ink" : "text-ink/25"}
              >
                ★
              </span>
              <span className="sr-only">
                {star} star{star === 1 ? "" : "s"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        How does it fit?
        <select
          name="fit"
          defaultValue=""
          className="h-10 w-full max-w-xs border border-input bg-card px-2"
        >
          <option value="">Prefer not to say</option>
          <option value="runs_small">Runs small</option>
          <option value="true_to_size">True to size</option>
          <option value="runs_large">Runs large</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Headline (optional)
        <input
          name="title"
          maxLength={100}
          className="h-10 border border-input bg-card px-3"
        />
      </label>
      <label className="flex flex-col gap-1">
        Your review
        <textarea
          name="body"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          className="border border-input bg-card p-3"
        />
        {errors.body && (
          <span className="text-destructive">{errors.body[0]}</span>
        )}
      </label>
      <PhotoPicker onChange={setPhotoIds} />
      <Button
        type="submit"
        disabled={pending}
        className="self-start rounded-none"
      >
        {pending ? "Sending…" : "Submit review"}
      </Button>
    </form>
  )
}
