"use client"

import { useState } from "react"

import { MediaImage } from "@/components/media-image"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { MediaRef } from "@/features/catalog"

/** Swipe on mobile (scroll-snap), a two-column grid with zoom on desktop. */
export function Gallery({
  images,
  title,
}: {
  images: MediaRef[]
  title: string
}) {
  const [zoomed, setZoomed] = useState<MediaRef | null>(null)
  if (images.length === 0) {
    return <div className="aspect-[4/5] w-full bg-secondary" />
  }
  return (
    <>
      <ul
        aria-label={`${title} images`}
        // Scrollable on phones, so it must be reachable by keyboard.
        tabIndex={0}
        className="-mx-4 flex snap-x snap-mandatory overflow-x-auto md:mx-0 md:grid md:grid-cols-2 md:gap-2 md:overflow-visible"
      >
        {images.map((image, index) => (
          <li
            key={`${image.key}-${index}`}
            className="relative aspect-[4/5] w-full shrink-0 snap-center bg-secondary"
          >
            <button
              type="button"
              onClick={() => setZoomed(image)}
              className="absolute inset-0 hidden cursor-zoom-in md:block"
            >
              <span className="sr-only">Enlarge image {index + 1}</span>
            </button>
            <MediaImage
              media={image}
              alt={image.alt || title}
              fill
              preload={index === 0}
              sizes="(min-width: 768px) 30vw, 100vw"
              className="pointer-events-none object-cover"
            />
            <span className="absolute right-3 bottom-3 bg-ink/70 px-2 py-0.5 text-xs text-paper md:hidden">
              {index + 1} / {images.length}
            </span>
          </li>
        ))}
      </ul>
      <Dialog
        open={zoomed !== null}
        onOpenChange={(open) => !open && setZoomed(null)}
      >
        <DialogContent className="max-w-[min(90vw,60rem)] bg-paper p-2 sm:max-w-[min(90vw,60rem)]">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {zoomed && (
            <div className="relative aspect-[4/5] max-h-[85vh] w-full">
              <MediaImage
                media={zoomed}
                alt={zoomed.alt || title}
                fill
                sizes="90vw"
                className="object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
