import { uploadImage } from "@/features/media"
import { getServerEnv } from "@/config/env"
import { getActor } from "@/server/auth/session"
import { DomainError } from "@/server/errors"
import { errorResponse } from "@/server/http"

/**
 * Staff image upload (multipart field `file`, optional `altText`). Caddy also
 * caps the body size (doc/07); the check here protects development.
 */
export async function POST(request: Request) {
  const actor = await getActor()
  try {
    const maxBytes = getServerEnv().MEDIA_MAX_UPLOAD_BYTES
    const declared = Number(request.headers.get("content-length") ?? 0)
    // Multipart overhead is small; reject clearly oversized bodies unread.
    if (declared > maxBytes + 64 * 1024) {
      throw new DomainError("PAYLOAD_TOO_LARGE", "That file is too large.")
    }

    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Attach an image in the `file` field.",
      )
    }
    const altText = form.get("altText")

    const uploaded = await uploadImage(actor, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      altText: typeof altText === "string" ? altText : "",
    })
    return Response.json(uploaded, { status: uploaded.reused ? 200 : 201 })
  } catch (error) {
    return errorResponse(error, actor.requestId)
  }
}
