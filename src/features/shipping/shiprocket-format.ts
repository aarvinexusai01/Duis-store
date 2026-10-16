/**
 * Shiprocket's tracking payloads, parsed without I/O so they are unit-tested.
 * Field names follow Shiprocket's webhook documentation and are re-checked
 * with the first real test shipment (doc/10 A5).
 */
import type { TrackingEvent } from "./provider"

/** Shiprocket times are IST without a zone: "2026-10-16 11:59:16" or "16 10 2026 11:59:16". */
export function parseShiprocketTime(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  )
  const dmy =
    /^(\d{2})[ /-](\d{2})[ /-](\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      value.trim(),
    )
  const parts = iso
    ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]]
    : dmy
      ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]]
      : null
  if (!parts) return null
  const [y, mo, d, h, mi, s = "00"] = parts
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+05:30`)
  return Number.isNaN(date.getTime()) ? null : date
}

const text = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null

export type ParsedTrackingWebhook = {
  awb: string
  eventId: string
  event: TrackingEvent
}

/** A tracking webhook body, or null when it isn't one we can use. */
export function parseShiprocketWebhook(
  payload: unknown,
): ParsedTrackingWebhook | null {
  if (!payload || typeof payload !== "object") return null
  const body = payload as Record<string, unknown>
  const awb = text(body.awb, 40)
  const status = text(body.current_status ?? body.shipment_status, 80)
  const occurredAt =
    parseShiprocketTime(body.current_timestamp) ??
    parseShiprocketTime(
      Array.isArray(body.scans)
        ? (body.scans.at(-1) as Record<string, unknown> | undefined)?.date
        : null,
    )
  if (!awb || !status || !occurredAt) return null
  const lastScan = Array.isArray(body.scans)
    ? (body.scans.at(-1) as Record<string, unknown> | undefined)
    : undefined
  return {
    awb,
    eventId: `${awb}:${status}:${occurredAt.toISOString()}`,
    event: {
      providerStatus: status.toUpperCase(),
      occurredAt,
      location: text(lastScan?.location),
      description: text(lastScan?.activity),
    },
  }
}

/** The scans in GET /courier/track/awb/{awb}. */
export function parseShiprocketTracking(payload: unknown): TrackingEvent[] {
  const data = (payload as { tracking_data?: Record<string, unknown> })
    ?.tracking_data
  const scans = Array.isArray(data?.shipment_track_activities)
    ? (data.shipment_track_activities as Record<string, unknown>[])
    : []
  const events: TrackingEvent[] = []
  for (const scan of scans) {
    const status = text(scan["sr-status-label"] ?? scan.status, 80)
    const occurredAt = parseShiprocketTime(scan.date)
    if (!status || !occurredAt) continue
    events.push({
      providerStatus: status.toUpperCase(),
      occurredAt,
      location: text(scan.location),
      description: text(scan.activity),
    })
  }
  return events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
}
