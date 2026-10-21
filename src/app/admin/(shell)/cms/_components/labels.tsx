"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type Option = { id: string; label: string }

type Labels = {
  media: Map<string, { key: string; alt: string }>
  products: Map<string, string>
  collections: Option[]
  categories: Option[]
  /** Pages by slug (id = slug), for menu links. */
  pages: Option[]
  addMedia: (item: { id: string; key: string; alt: string }) => void
  addProduct: (id: string, label: string) => void
}

const LabelsContext = createContext<Labels | null>(null)

/**
 * Names and thumbnails for what the page points at, so the builder can show
 * "Winter Layers" rather than an ID. Seeded by the server, extended as
 * staff pick new items.
 */
export function LabelsProvider({
  initial,
  children,
}: {
  initial: {
    media: { id: string; key: string; alt: string }[]
    products: Option[]
    collections: Option[]
    categories: Option[]
    pages: Option[]
  }
  children: ReactNode
}) {
  const [media, setMedia] = useState(
    () => new Map(initial.media.map((m) => [m.id, { key: m.key, alt: m.alt }])),
  )
  const [products, setProducts] = useState(
    () => new Map(initial.products.map((p) => [p.id, p.label])),
  )
  const addMedia = useCallback(
    (item: { id: string; key: string; alt: string }) =>
      setMedia((current) =>
        new Map(current).set(item.id, { key: item.key, alt: item.alt }),
      ),
    [],
  )
  const addProduct = useCallback(
    (id: string, label: string) =>
      setProducts((current) => new Map(current).set(id, label)),
    [],
  )
  const value = useMemo(
    () => ({
      media,
      products,
      collections: initial.collections,
      categories: initial.categories,
      pages: initial.pages,
      addMedia,
      addProduct,
    }),
    [
      media,
      products,
      initial.collections,
      initial.categories,
      initial.pages,
      addMedia,
      addProduct,
    ],
  )
  return <LabelsContext value={value}>{children}</LabelsContext>
}

export function useLabels(): Labels {
  const labels = useContext(LabelsContext)
  if (!labels) throw new Error("useLabels needs <LabelsProvider>")
  return labels
}
