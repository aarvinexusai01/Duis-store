/** A small square product photo from a stored media key (no next/image overhead). */
export function MediaThumb({
  mediaKey,
  size = 64,
}: {
  mediaKey: string | null
  size?: number
}) {
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-secondary"
      style={{ width: size, height: size * 1.25 }}
    >
      {mediaKey && (
        // eslint-disable-next-line @next/next/no-img-element -- fixed stored rendition
        <img
          src={`/media/${mediaKey}/320.webp`}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  )
}
