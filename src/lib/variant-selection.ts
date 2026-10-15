/**
 * Pure variant-picker rules for the product page (unit-tested). A selection
 * maps axis code → value slug, e.g. { color: "black", size: "m" }.
 */

export type Axis = { code: string; values: { slug: string }[] }
export type VariantOptions = { id: string; options: Record<string, string> }
export type Selection = Record<string, string | undefined>
/** Units available per variant id; null while unknown. */
export type Stock = Record<string, number> | null

function matches(variant: VariantOptions, selection: Selection, skip?: string) {
  return Object.entries(selection).every(
    ([code, value]) =>
      code === skip || value === undefined || variant.options[code] === value,
  )
}

/** The variant for a complete selection, if that combination exists. */
export function findVariant<V extends VariantOptions>(
  axes: Axis[],
  variants: V[],
  selection: Selection,
): V | undefined {
  if (axes.some((axis) => !selection[axis.code])) return undefined
  return variants.find((variant) => matches(variant, selection))
}

/**
 * Whether choosing `value` on axis `code` (keeping the other choices) leads
 * anywhere: "missing" if no such combination exists, "sold_out" if every
 * match has no stock, else "available". Unknown stock counts as available.
 */
export function optionState(
  variants: VariantOptions[],
  selection: Selection,
  stock: Stock,
  code: string,
  value: string,
): "available" | "sold_out" | "missing" {
  const candidates = variants.filter(
    (variant) =>
      variant.options[code] === value && matches(variant, selection, code),
  )
  if (candidates.length === 0) return "missing"
  if (stock === null) return "available"
  return candidates.some((variant) => (stock[variant.id] ?? 0) > 0)
    ? "available"
    : "sold_out"
}

/**
 * Starting selection: valid values from the URL first; otherwise the first
 * colour, and axes with a single value pre-select.
 * Sizes are left for the customer to choose.
 */
export function initialSelection(
  axes: Axis[],
  variants: VariantOptions[],
  query: Record<string, string | undefined>,
): Selection {
  const selection: Selection = {}
  for (const axis of axes) {
    const requested = query[axis.code]
    if (requested && axis.values.some((value) => value.slug === requested)) {
      selection[axis.code] = requested
    } else if (axis.values.length === 1) {
      selection[axis.code] = axis.values[0]!.slug
    } else if (axis.code === "color") {
      selection[axis.code] = axis.values[0]?.slug
    }
  }
  // A requested combination that does not exist keeps only the colour.
  if (
    axes.every((axis) => selection[axis.code]) &&
    !findVariant(axes, variants, selection)
  ) {
    for (const axis of axes) {
      if (axis.code !== "color" && axis.values.length > 1) {
        selection[axis.code] = undefined
      }
    }
  }
  return selection
}
