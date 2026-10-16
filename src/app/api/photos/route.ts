import { uploadCustomerPhoto } from "@/features/media"
import { getActor } from "@/server/auth/session"
import { DomainError } from "@/server/errors"
import { errorResponse } from "@/server/http"

/** A customer's photo for an exchange or review (multipart field `file`). */
export async function POST(request: Request) {
  const actor = await getActor()
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) {
      throw new DomainError("PAYLOAD_TOO_LARGE", "Photos must be under 8 MB.")
    }
    const file = (await request.formData()).get("file")
    if (!(file instanceof File)) {
      throw new DomainError("VALIDATION_FAILED", "Attach a photo.")
    }
    const photo = await uploadCustomerPhoto(actor, {
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    return Response.json(photo, { status: 201 })
  } catch (error) {
    return errorResponse(error, actor.requestId)
  }
}
