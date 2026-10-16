import { getProductReviews } from "@/features/reviews"

const FIT_LABEL: Record<string, string> = {
  runs_small: "Runs small",
  true_to_size: "True to size",
  runs_large: "Runs large",
}

function Stars({
  rating,
  size = "text-base",
}: {
  rating: number
  size?: string
}) {
  return (
    <span
      aria-label={`${rating} out of 5 stars`}
      className={`${size} tracking-wider`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          aria-hidden
          className={star <= Math.round(rating) ? "text-ink" : "text-ink/20"}
        >
          ★
        </span>
      ))}
    </span>
  )
}

/** Approved reviews from verified buyers, with the fit people reported. */
export async function ProductReviews({ productId }: { productId: string }) {
  const data = await getProductReviews(productId)
  const fitVotes =
    data.fit.runs_small + data.fit.true_to_size + data.fit.runs_large
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="page-container scroll-mt-24 py-10"
    >
      <h2 id="reviews-heading" className="display-heading text-3xl">
        Reviews
      </h2>
      {data.count === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No reviews yet. Bought this? You can review it from your order page
          once it&apos;s delivered.
        </p>
      ) : (
        <div className="mt-4 grid gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="text-sm">
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold">
                {data.average.toFixed(1)}
              </span>
              <Stars rating={data.average} />
            </p>
            <p className="text-muted-foreground">
              {data.count} verified review{data.count === 1 ? "" : "s"}
            </p>
            <dl className="mt-3 flex flex-col gap-1">
              {([5, 4, 3, 2, 1] as const).map((star) => (
                <div key={star} className="flex items-center gap-2">
                  <dt className="w-8">{star}★</dt>
                  <dd className="h-1.5 flex-1 bg-border">
                    <span
                      className="block h-full bg-ink"
                      style={{
                        width: `${(data.distribution[star] / data.count) * 100}%`,
                      }}
                    />
                  </dd>
                  <dd className="w-6 text-right text-muted-foreground tabular-nums">
                    {data.distribution[star]}
                  </dd>
                </div>
              ))}
            </dl>
            {fitVotes > 0 && (
              <p className="mt-3">
                Fit:{" "}
                {(["runs_small", "true_to_size", "runs_large"] as const)
                  .map(
                    (key) =>
                      `${FIT_LABEL[key]} ${Math.round((data.fit[key] / fitVotes) * 100)}%`,
                  )
                  .join(" · ")}
              </p>
            )}
          </div>
          <ul className="flex flex-col divide-y">
            {data.reviews.map((review) => (
              <li key={review.id} className="py-4 text-sm first:pt-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} size="text-sm" />
                  {review.title && (
                    <span className="font-semibold">{review.title}</span>
                  )}
                </p>
                <p className="mt-1 whitespace-pre-line">{review.body}</p>
                {review.photoIds.length > 0 && (
                  <p className="mt-2 flex gap-2">
                    {review.photoIds.map((id) => (
                      // eslint-disable-next-line @next/next/no-img-element -- served by /photos, already resized
                      <img
                        key={id}
                        src={`/photos/${id}`}
                        alt="Photo from the reviewer"
                        loading="lazy"
                        className="size-20 object-cover"
                      />
                    ))}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {review.displayName} · verified buyer
                  {review.fit && ` · ${FIT_LABEL[review.fit]}`} ·{" "}
                  {review.createdAt.toLocaleDateString("en-IN", {
                    dateStyle: "medium",
                    timeZone: "Asia/Kolkata",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
