import { connection, type NextRequest } from "next/server"

import { getShipmentLabel } from "@/features/orders"
import { getActor } from "@/server/auth/session"
import { isDomainError } from "@/server/errors"

/**
 * A parcel's shipping label (private storage). The operation checks the
 * staff permission; anyone else gets a 404, like the rest of /admin.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/admin/shipments/[id]/label">,
) {
  await connection()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 })
  try {
    const label = await getShipmentLabel(await getActor(), { shipmentId: id })
    return new Response(new Uint8Array(label.data), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="label-${label.awb ?? id}.pdf"`,
        "cache-control": "private, no-store",
      },
    })
  } catch (error) {
    if (isDomainError(error)) return new Response(null, { status: 404 })
    throw error
  }
}
