import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getDb } from "@/server/db/client"
import { defineOperation } from "@/server/operation"

import { getShippingProvider, type Serviceability } from "./provider"

/** Courier answers are cached per PIN code for a day (doc/05, shipping). */
const CACHE_HOURS = 24

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code.")

export const checkServiceability = defineOperation({
  name: "shipping.checkServiceability",
  access: "public",
  input: z.object({ pincode: pincodeSchema }),
  async handler({ log }, { pincode }): Promise<Serviceability> {
    const db = getDb()
    const cached = await db.execute<{
      serviceable: boolean
      prepaid_available: boolean
      cod_available: boolean
      edd_min_days: number | null
      edd_max_days: number | null
    }>(sql`
      select serviceable, prepaid_available, cod_available, edd_min_days, edd_max_days
      from pincode_serviceability
      where pincode = ${pincode}
        and checked_at > now() - make_interval(hours => ${CACHE_HOURS})`)
    const row = cached.rows[0]
    if (row) {
      return {
        serviceable: row.serviceable,
        prepaidAvailable: row.prepaid_available,
        codAvailable: row.cod_available,
        eddMinDays: row.edd_min_days,
        eddMaxDays: row.edd_max_days,
      }
    }

    const provider = getShippingProvider()
    const answer = await provider.checkServiceability(pincode)
    await db.execute(sql`
      insert into pincode_serviceability
        (pincode, serviceable, prepaid_available, cod_available, edd_min_days, edd_max_days, provider, checked_at)
      values (${pincode}, ${answer.serviceable}, ${answer.prepaidAvailable}, ${answer.codAvailable},
              ${answer.eddMinDays}, ${answer.eddMaxDays}, ${provider.name}, now())
      on conflict (pincode) do update set
        serviceable = excluded.serviceable,
        prepaid_available = excluded.prepaid_available,
        cod_available = excluded.cod_available,
        edd_min_days = excluded.edd_min_days,
        edd_max_days = excluded.edd_max_days,
        provider = excluded.provider,
        checked_at = excluded.checked_at`)
    log.debug({ provider: provider.name }, "serviceability refreshed")
    return answer
  },
})
