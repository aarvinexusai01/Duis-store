"use client"

import { UploadIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type Progress = { name: string; percent: number }

/** Uploads one file with progress (XMLHttpRequest reports upload progress). */
function send(file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", "/api/media/upload")
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      if (request.status < 300) resolve()
      else {
        const message = (() => {
          try {
            return JSON.parse(request.responseText)?.error?.message
          } catch {
            return null
          }
        })()
        reject(new Error(message ?? "Upload failed"))
      }
    }
    request.onerror = () => reject(new Error("Network error"))
    const body = new FormData()
    body.set("file", file)
    request.send(body)
  })
}

/** Several images at once, one after another, each with its progress. */
export function UploadButton() {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<Progress[]>([])

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    setProgress(list.map((file) => ({ name: file.name, percent: 0 })))
    let done = 0
    for (const [index, file] of list.entries()) {
      try {
        await send(file, (percent) =>
          setProgress((current) =>
            current.map((p, i) => (i === index ? { ...p, percent } : p)),
          ),
        )
        done += 1
      } catch (error) {
        toast.error(`${file.name}: ${(error as Error).message}`)
      }
    }
    setProgress([])
    if (input.current) input.current.value = ""
    if (done > 0)
      toast.success(`${done} image${done === 1 ? "" : "s"} uploaded`)
    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id="media-upload-many"
        onChange={(event) => void upload(event.target.files)}
      />
      <Button
        className="rounded-sm"
        disabled={progress.length > 0}
        onClick={() => input.current?.click()}
      >
        <UploadIcon className="size-4" aria-hidden /> Upload images
      </Button>
      {progress.length > 0 && (
        <ul aria-live="polite" className="w-64 space-y-1 text-xs">
          {progress.map((p) => (
            <li key={p.name}>
              <span className="block truncate">{p.name}</span>
              <progress
                value={p.percent}
                max={100}
                aria-label={`Uploading ${p.name}`}
                className="h-1.5 w-full"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
