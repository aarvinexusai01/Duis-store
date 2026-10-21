"use client"

import { PlayIcon } from "lucide-react"
import { useState } from "react"

/**
 * A YouTube video that loads nothing from Google until the reader presses
 * play (doc/06 Phase 6c), then plays from youtube-nocookie.com.
 */
export function YouTubeEmbed({
  videoId,
  title,
}: {
  videoId: string
  title?: string
}) {
  const [playing, setPlaying] = useState(false)
  const label = title ?? "Video"
  return (
    <figure className="my-8">
      <div className="relative aspect-video overflow-hidden bg-ink">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title={label}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-3 text-paper"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-rust transition-transform group-hover:scale-110">
              <PlayIcon className="size-7 fill-current" aria-hidden />
            </span>
            <span className="px-6 text-center text-sm font-semibold">
              Play {title ? `“${title}”` : "video"}
            </span>
            <span className="text-xs text-chrome-muted">
              Plays from YouTube when you press play.
            </span>
          </button>
        )}
      </div>
    </figure>
  )
}
