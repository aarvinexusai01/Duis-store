"use client"

/** Last resort when the root layout itself fails; no app styles are loaded. */
export default function GlobalError({
  retry,
}: {
  error: Error
  retry: () => void
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "4rem 1.5rem",
          background: "#f4f1ea",
          color: "#111",
        }}
      >
        <h1>Something went wrong</h1>
        <p>Sorry — the store didn&apos;t load. Please try again in a moment.</p>
        <button type="button" onClick={() => retry()}>
          Try again
        </button>
      </body>
    </html>
  )
}
