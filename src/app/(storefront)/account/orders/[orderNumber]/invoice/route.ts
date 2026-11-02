import { connection, type NextRequest } from "next/server"

import { getMyOrderInvoice } from "@/features/orders"
import { getActor } from "@/server/auth/session"
import { isDomainError } from "@/server/errors"

/**
 * The signed-in customer's invoice for one of their own orders (the
 * courier's PDF, doc/01 D10). Anyone else's order is a 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteContext<"/account/orders/[orderNumber]/invoice">,
) {
  await connection()
  const { orderNumber } = await params
  try {
    const invoice = await getMyOrderInvoice(await getActor(), { orderNumber })
    return new Response(new Uint8Array(invoice.data), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="Invoice-${orderNumber}.pdf"`,
        "cache-control": "private, no-store",
      },
    })
  } catch (error) {
    if (isDomainError(error)) {
      return new Response(
        "Your invoice isn't ready yet. Please try again in a little while.",
        {
          status: 404,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "private, no-store",
          },
        },
      )
    }
    throw error
  }
}
