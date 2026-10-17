import type { ConsentChoice } from "../consent"

/**
 * GA4 and the Meta Pixel, loaded only after consent (ADR-0027). Consent
 * Mode "basic": gtag.js isn't requested at all until analytics consent, so
 * nothing reaches Google before it. Events raised before the visitor
 * answers wait here, and are dropped if they decline.
 */

type Gtag = (...args: unknown[]) => void
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push: Fbq
  loaded: boolean
  version: string
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
    fbq?: Fbq
    _fbq?: Fbq
  }
}

export type AnalyticsItem = {
  /** Product ID (the same ID the server sends to Meta). */
  id: string
  name: string
  variant?: string
  pricePaise: number
  quantity: number
}

export type AnalyticsEvent =
  | { name: "view_item"; item: AnalyticsItem }
  | { name: "add_to_cart"; item: AnalyticsItem }
  | { name: "begin_checkout"; items: AnalyticsItem[]; valuePaise: number }
  | {
      name: "purchase"
      orderNumber: string
      /** Shared with the Conversions API so Meta counts it once. */
      eventId: string
      valuePaise: number
      taxPaise: number
      shippingPaise: number
      coupon?: string
      items: AnalyticsItem[]
    }

const state = {
  decided: false,
  ga4: false,
  pixel: false,
  pending: [] as AnalyticsEvent[],
}

function addScript(src: string) {
  const script = document.createElement("script")
  script.async = true
  script.src = src
  document.head.append(script)
}

function startGa4(id: string, consent: ConsentChoice) {
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? []
    window.gtag = function gtag() {
      // gtag.js reads the arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments)
    }
    const ads = consent.marketing ? "granted" : "denied"
    window.gtag("consent", "default", {
      analytics_storage: "granted",
      ad_storage: ads,
      ad_user_data: ads,
      ad_personalization: ads,
    })
    window.gtag("js", new Date())
    // Later page views come from GA4's history-change measurement.
    window.gtag("config", id)
    addScript(
      `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,
    )
  }
  state.ga4 = true
}

function startPixel(id: string) {
  if (!window.fbq) {
    // Meta's loader stub: queues calls until fbevents.js arrives.
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue.push(args)
    } as Fbq
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = "2.0"
    fbq.queue = []
    window.fbq = fbq
    window._fbq ??= fbq
    addScript("https://connect.facebook.net/en_US/fbevents.js")
    fbq("init", id)
  }
  state.pixel = true
}

/** Called by <Analytics> whenever the answer or the IDs change. */
export function applyConsent(
  consent: ConsentChoice | null,
  ids: { ga4Id: string | null; pixelId: string | null },
) {
  if (!consent) return
  if (consent.analytics && ids.ga4Id) startGa4(ids.ga4Id, consent)
  if (consent.marketing && ids.pixelId) startPixel(ids.pixelId)
  state.decided = true
  const waiting = state.pending.splice(0)
  for (const event of waiting) send(event)
}

/** A trackers that already loaded can't be unloaded: say whether to reload. */
export function needsReloadFor(consent: ConsentChoice): boolean {
  return (
    (state.ga4 && !consent.analytics) || (state.pixel && !consent.marketing)
  )
}

/** Meta Pixel page view, on first load and each client-side navigation. */
export function pixelPageView() {
  if (state.pixel) window.fbq?.("track", "PageView")
}

const rupees = (paise: number) => Math.round(paise) / 100

function gaItems(items: AnalyticsItem[]) {
  return items.map((item) => ({
    item_id: item.id,
    item_name: item.name,
    ...(item.variant ? { item_variant: item.variant } : {}),
    price: rupees(item.pricePaise),
    quantity: item.quantity,
  }))
}

function metaContents(items: AnalyticsItem[]) {
  return {
    content_type: "product",
    content_ids: items.map((item) => item.id),
    contents: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      item_price: rupees(item.pricePaise),
    })),
    currency: "INR",
  }
}

function send(event: AnalyticsEvent) {
  const gtag = state.ga4 ? window.gtag : undefined
  const fbq = state.pixel ? window.fbq : undefined
  switch (event.name) {
    case "view_item":
    case "add_to_cart": {
      const value = rupees(event.item.pricePaise * event.item.quantity)
      gtag?.("event", event.name, {
        currency: "INR",
        value,
        items: gaItems([event.item]),
      })
      fbq?.("track", event.name === "view_item" ? "ViewContent" : "AddToCart", {
        ...metaContents([event.item]),
        value,
        content_name: event.item.name,
      })
      break
    }
    case "begin_checkout":
      gtag?.("event", "begin_checkout", {
        currency: "INR",
        value: rupees(event.valuePaise),
        items: gaItems(event.items),
      })
      fbq?.("track", "InitiateCheckout", {
        ...metaContents(event.items),
        value: rupees(event.valuePaise),
        num_items: event.items.reduce((n, i) => n + i.quantity, 0),
      })
      break
    case "purchase":
      gtag?.("event", "purchase", {
        transaction_id: event.orderNumber,
        currency: "INR",
        value: rupees(event.valuePaise),
        tax: rupees(event.taxPaise),
        shipping: rupees(event.shippingPaise),
        ...(event.coupon ? { coupon: event.coupon } : {}),
        items: gaItems(event.items),
      })
      fbq?.(
        "track",
        "Purchase",
        {
          ...metaContents(event.items),
          value: rupees(event.valuePaise),
          order_id: event.orderNumber,
          num_items: event.items.reduce((n, i) => n + i.quantity, 0),
        },
        { eventID: event.eventId },
      )
      break
  }
}

/**
 * Records an e-commerce event if the visitor allowed it. Before they answer,
 * it waits (up to 20 events) for their choice.
 */
export function track(event: AnalyticsEvent) {
  if (!state.decided) {
    if (state.pending.length < 20) state.pending.push(event)
    return
  }
  send(event)
}

/** Removes analytics and ad cookies after consent is withdrawn. */
export function clearTrackingCookies() {
  const names = document.cookie
    .split("; ")
    .map((part) => part.split("=")[0]!)
    .filter((name) => /^(_ga|_gid|_gat|_gcl|_fbp|_fbc)/.test(name))
  const host = window.location.hostname
  const parts = host.split(".")
  const domains = ["", host, `.${host}`]
  if (parts.length > 2) domains.push(`.${parts.slice(-2).join(".")}`)
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`
    }
  }
}
