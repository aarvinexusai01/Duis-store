"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  DISPLAY_CURRENCY_COOKIE,
  LAST_CURRENCY_KEY,
  parseDisplayCurrency,
  PRICE_PENDING_ATTRIBUTE,
  type VisitorPricing,
} from "@/lib/display-currency"
import { formatMoney, paiseToUsdCents, type Currency } from "@/lib/fx"

/**
 * The currency prices are shown in (doc/06 Phase 13d, ADR-0034). The server
 * renders rupees; once the page is interactive this asks /api/pricing for
 * the visitor's terms and every <Price> and <Money> re-renders in dollars
 * where that applies. Outside the provider (checkout, admin) it is rupees.
 */

type DisplayCurrency = {
  currency: Currency
  /** Null while rupees only (switched off, a search engine, or loading). */
  usd: VisitorPricing["usd"]
  setCurrency: (currency: Currency) => void
}

const Context = createContext<DisplayCurrency>({
  currency: "INR",
  usd: null,
  setCurrency: () => {},
})

function readCookie(name: string): string | null {
  for (const part of document.cookie.split("; ")) {
    const [key, ...value] = part.split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return null
}

function remember(currency: Currency) {
  try {
    localStorage.setItem(LAST_CURRENCY_KEY, currency)
  } catch {
    // Private windows and blocked storage: only the flash comes back.
  }
}

export function DisplayCurrencyProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [pricing, setPricing] = useState<VisitorPricing | null>(null)
  const [chosen, setChosen] = useState<Currency | null>(null)
  const [resolved, setResolved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/pricing")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: VisitorPricing | null) => {
        if (cancelled) return
        setChosen(parseDisplayCurrency(readCookie(DISPLAY_CURRENCY_COOKIE)))
        setPricing(body)
      })
      .catch(() => {
        // Offline or failed: rupees, as rendered.
      })
      .finally(() => {
        if (!cancelled) setResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const usd = pricing?.usd ?? null
  const currency: Currency = usd
    ? (chosen ?? pricing?.suggested ?? "INR")
    : "INR"

  // After the converted prices are on screen: show them, and remember.
  useEffect(() => {
    if (!resolved) return
    document.documentElement.removeAttribute(PRICE_PENDING_ATTRIBUTE)
    remember(currency)
  }, [resolved, currency])

  const setCurrency = useCallback((next: Currency) => {
    document.cookie = `${DISPLAY_CURRENCY_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    setChosen(next)
  }, [])

  const value = useMemo(
    () => ({ currency, usd, setCurrency }),
    [currency, usd, setCurrency],
  )
  return <Context value={value}>{children}</Context>
}

export function useDisplayCurrency(): DisplayCurrency {
  return useContext(Context)
}

/** Converts and formats rupee amounts in the shown currency. */
export function useMoney() {
  const { currency, usd } = useContext(Context)
  return useMemo(() => {
    const toMinor = (paise: number) =>
      currency === "USD" && usd ? paiseToUsdCents(paise, usd) : paise
    return {
      currency,
      usd: currency === "USD" ? usd : null,
      toMinor,
      format: (paise: number) => formatMoney(toMinor(paise), currency),
      /** Already converted amounts (sums of converted prices). */
      formatMinor: (minor: number) => formatMoney(minor, currency),
    }
  }, [currency, usd])
}

/** A rupee amount, shown in the visitor's currency. */
export function Money({
  paise,
  className,
}: {
  paise: number
  className?: string
}) {
  const money = useMoney()
  return (
    <span data-price className={className}>
      {money.format(paise)}
    </span>
  )
}
