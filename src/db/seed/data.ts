/**
 * Demo catalogue for development (doc/01 decision 12): realistic menswear
 * without real brands or imagery. Prices are in rupees here and converted to
 * paise by the seed.
 */

export type Garment =
  "tee" | "polo" | "shirt" | "hoodie" | "sweatshirt" | "pants" | "shorts"

export const COLOURS = [
  { slug: "black", label: "Black", hex: "#111111", group: "black" },
  { slug: "white", label: "White", hex: "#f4f4f2", group: "white" },
  { slug: "off-white", label: "Off-White", hex: "#ece5d8", group: "white" },
  { slug: "navy", label: "Navy", hex: "#1f2a44", group: "blue" },
  { slug: "olive", label: "Olive", hex: "#556b2f", group: "green" },
  { slug: "maroon", label: "Maroon", hex: "#6d1a2a", group: "red" },
  { slug: "beige", label: "Beige", hex: "#d8c3a5", group: "brown" },
  {
    slug: "grey-melange",
    label: "Grey Melange",
    hex: "#a0a4a8",
    group: "grey",
  },
  { slug: "sky-blue", label: "Sky Blue", hex: "#8db8dc", group: "blue" },
  { slug: "acid-wash", label: "Acid Wash", hex: "#6e7378", group: "grey" },
  { slug: "mustard", label: "Mustard", hex: "#d9a521", group: "yellow" },
  { slug: "lavender", label: "Lavender", hex: "#b8a9d9", group: "purple" },
  { slug: "charcoal", label: "Charcoal", hex: "#36454f", group: "grey" },
  { slug: "indigo", label: "Indigo", hex: "#2e3a59", group: "blue" },
  { slug: "light-blue", label: "Light Blue", hex: "#9cbbd9", group: "blue" },
  { slug: "khaki", label: "Khaki", hex: "#b5a27a", group: "brown" },
  { slug: "rust", label: "Rust", hex: "#b7472a", group: "orange" },
] as const

export type ColourSlug = (typeof COLOURS)[number]["slug"]

export const ALPHA_SIZES = ["s", "m", "l", "xl", "xxl", "3xl"] as const
export const WAIST_SIZES = ["28", "30", "32", "34", "36", "38"] as const

export const DESCRIPTIVE = {
  fit: ["oversized", "regular", "slim", "relaxed", "boxy"],
  sleeve: ["half-sleeve", "full-sleeve"],
  pattern: ["solid", "graphic", "washed", "striped", "textured"],
} as const

export const SIZE_CHARTS = {
  tops: {
    name: "Tops (inches)",
    columns: ["Chest", "Length", "Shoulder"],
    rows: [
      { size: "S", values: ["40", "27", "18"] },
      { size: "M", values: ["42", "28", "18.5"] },
      { size: "L", values: ["44", "29", "19"] },
      { size: "XL", values: ["46", "30", "20"] },
      { size: "2XL", values: ["48", "31", "21"] },
      { size: "3XL", values: ["50", "32", "22"] },
    ],
  },
  bottoms: {
    name: "Bottoms (inches)",
    columns: ["Waist", "Hip", "Inseam"],
    rows: WAIST_SIZES.map((waist) => ({
      size: waist,
      values: [waist, String(Number(waist) + 10), "31"],
    })),
  },
}

type CategorySeed = {
  slug: string
  name: string
  hsn?: string
  chart?: keyof typeof SIZE_CHARTS
  /** One of the owner's charts, added by migration 0016_owner_size_charts. */
  ownerChart?: string
  children?: CategorySeed[]
}

export const CATEGORY_TREE: CategorySeed[] = [
  {
    slug: "t-shirts",
    name: "T-Shirts",
    hsn: "6109",
    chart: "tops",
    children: [
      {
        slug: "oversized-t-shirts",
        name: "Oversized T-Shirts",
        ownerChart: "Oversized T-Shirt",
      },
      {
        slug: "regular-fit-t-shirts",
        name: "Regular Fit T-Shirts",
        ownerChart: "Regular Fit T-Shirt",
      },
      {
        slug: "graphic-t-shirts",
        name: "Graphic T-Shirts",
        ownerChart: "Oversized T-Shirt",
      },
      {
        slug: "polo-t-shirts",
        name: "Polo T-Shirts",
        hsn: "6105",
        ownerChart: "Regular Fit T-Shirt",
      },
    ],
  },
  {
    slug: "shirts",
    name: "Shirts",
    hsn: "6205",
    chart: "tops",
    children: [
      { slug: "casual-shirts", name: "Casual Shirts" },
      { slug: "linen-shirts", name: "Linen Shirts" },
      { slug: "overshirts", name: "Overshirts" },
    ],
  },
  {
    slug: "hoodies-and-sweatshirts",
    name: "Hoodies & Sweatshirts",
    hsn: "6110",
    chart: "tops",
    children: [
      { slug: "hoodies", name: "Hoodies", ownerChart: "Oversized Hoodie" },
      {
        slug: "sweatshirts",
        name: "Sweatshirts",
        ownerChart: "Oversized Sweatshirt",
      },
    ],
  },
  {
    slug: "bottomwear",
    name: "Bottomwear",
    hsn: "6203",
    chart: "bottoms",
    children: [
      { slug: "jeans", name: "Jeans" },
      { slug: "trousers", name: "Trousers" },
      { slug: "shorts", name: "Shorts" },
      { slug: "joggers", name: "Joggers", hsn: "6103" },
    ],
  },
]

export type ProductSeed = {
  name: string
  category: string
  colours: ColourSlug[]
  price: number
  mrp: number
  fit: (typeof DESCRIPTIVE.fit)[number]
  pattern?: (typeof DESCRIPTIVE.pattern)[number]
  sleeve?: (typeof DESCRIPTIVE.sleeve)[number]
  tags?: string[]
}

type Group = {
  category: string
  garment: Garment
  weightGrams: number
  sizes: "alpha" | "waist"
  fabric: string
  products: Omit<ProductSeed, "category">[]
}

const tee = (
  name: string,
  colours: ColourSlug[],
  price: number,
  mrp: number,
  extra: Partial<ProductSeed> = {},
) =>
  ({
    name,
    colours,
    price,
    mrp,
    fit: "oversized",
    pattern: "solid",
    sleeve: "half-sleeve",
    ...extra,
  }) as const

export const PRODUCT_GROUPS: Group[] = [
  {
    category: "oversized-t-shirts",
    garment: "tee",
    weightGrams: 260,
    sizes: "alpha",
    fabric: "100% cotton, 240 GSM single jersey",
    products: [
      tee("Midnight Oversized Tee", ["black", "off-white"], 799, 1099),
      tee("Acid Wash Oversized Tee", ["acid-wash", "charcoal"], 1199, 1599, {
        pattern: "washed",
      }),
      tee("Bone Drop-Shoulder Tee", ["off-white", "beige"], 849, 1199),
      tee("Olive Heavyweight Tee", ["olive", "black"], 999, 1399),
      tee("Rust Boxy Tee", ["rust", "mustard"], 899, 1299, { fit: "boxy" }),
      tee("Lavender Haze Oversized Tee", ["lavender", "white"], 849, 1199),
      tee("Navy Street Oversized Tee", ["navy", "grey-melange"], 799, 1099),
      tee("Maroon Thermal Oversized Tee", ["maroon", "charcoal"], 1099, 1499, {
        pattern: "textured",
      }),
      tee("Khaki Utility Oversized Tee", ["khaki", "olive"], 949, 1299),
      tee("Sky Oversized Tee", ["sky-blue", "white"], 799, 999),
    ],
  },
  {
    category: "regular-fit-t-shirts",
    garment: "tee",
    weightGrams: 220,
    sizes: "alpha",
    fabric: "100% combed cotton, 180 GSM",
    products: [
      tee(
        "Essential Crew Tee",
        ["white", "black", "navy", "grey-melange"],
        499,
        699,
        { fit: "regular" },
      ),
      tee("Pocket Crew Tee", ["beige", "olive", "navy"], 599, 799, {
        fit: "regular",
      }),
      tee("Striped Breton Tee", ["white", "navy"], 749, 999, {
        fit: "regular",
        pattern: "striped",
      }),
      tee("Slub Cotton Tee", ["mustard", "sky-blue"], 649, 899, {
        fit: "regular",
        pattern: "textured",
      }),
      tee("Henley Tee", ["charcoal", "off-white"], 799, 1099, {
        fit: "slim",
        sleeve: "full-sleeve",
      }),
      tee("Longline Tee", ["black", "maroon"], 699, 999, { fit: "relaxed" }),
    ],
  },
  {
    category: "graphic-t-shirts",
    garment: "tee",
    weightGrams: 260,
    sizes: "alpha",
    fabric: "100% cotton, 220 GSM with puff print",
    products: [
      tee("Glitch Graphic Tee", ["black", "white"], 899, 1299, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Orbit Graphic Tee", ["off-white", "navy"], 899, 1299, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Static Noise Graphic Tee", ["charcoal", "lavender"], 949, 1299, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Concrete Jungle Graphic Tee", ["grey-melange", "black"], 899, 1199, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Sunburst Graphic Tee", ["mustard", "off-white"], 849, 1199, {
        pattern: "graphic",
        tags: ["graphic", "summer"],
      }),
      tee("Halftone Graphic Tee", ["white", "maroon"], 849, 1199, {
        fit: "regular",
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Night Shift Graphic Tee", ["navy", "black"], 949, 1299, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Signal Graphic Tee", ["olive", "black"], 899, 1199, {
        fit: "regular",
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Split Grid Graphic Tee", ["rust", "off-white"], 999, 1399, {
        pattern: "graphic",
        tags: ["graphic"],
      }),
      tee("Wave Form Graphic Tee", ["sky-blue", "charcoal"], 899, 1199, {
        pattern: "graphic",
        tags: ["graphic", "summer"],
      }),
    ],
  },
  {
    category: "polo-t-shirts",
    garment: "polo",
    weightGrams: 280,
    sizes: "alpha",
    fabric: "Cotton piqué, 220 GSM",
    products: [
      tee("Piqué Polo", ["navy", "white", "maroon"], 899, 1199, {
        fit: "regular",
      }),
      tee("Knit Polo", ["beige", "black"], 1299, 1699, {
        fit: "regular",
        pattern: "textured",
      }),
      tee("Tipped Polo", ["white", "navy"], 949, 1299, { fit: "slim" }),
      tee("Waffle Polo", ["olive", "off-white"], 1099, 1499, {
        fit: "relaxed",
        pattern: "textured",
      }),
      tee("Resort Polo", ["sky-blue", "mustard"], 999, 1399, {
        fit: "relaxed",
        tags: ["summer"],
      }),
    ],
  },
  {
    category: "casual-shirts",
    garment: "shirt",
    weightGrams: 300,
    sizes: "alpha",
    fabric: "100% cotton",
    products: [
      tee("Oxford Button-Down Shirt", ["white", "sky-blue"], 1299, 1799, {
        fit: "regular",
        sleeve: "full-sleeve",
      }),
      tee("Corduroy Shirt", ["rust", "olive"], 1599, 2199, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        pattern: "textured",
      }),
      tee("Denim Shirt", ["indigo", "light-blue"], 1499, 1999, {
        fit: "regular",
        sleeve: "full-sleeve",
      }),
      tee("Check Flannel Shirt", ["maroon", "navy"], 1399, 1899, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        pattern: "striped",
      }),
      tee("Cuban Collar Shirt", ["black", "beige"], 1199, 1599, {
        fit: "boxy",
        tags: ["summer"],
      }),
    ],
  },
  {
    category: "linen-shirts",
    garment: "shirt",
    weightGrams: 260,
    sizes: "alpha",
    fabric: "100% linen",
    products: [
      tee("Linen Camp Shirt", ["off-white", "sky-blue"], 1799, 2499, {
        fit: "relaxed",
        tags: ["summer"],
      }),
      tee("Linen Mandarin Shirt", ["beige", "olive"], 1899, 2599, {
        fit: "regular",
        sleeve: "full-sleeve",
        tags: ["summer"],
      }),
      tee("Linen Relaxed Shirt", ["white", "lavender"], 1799, 2399, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        tags: ["summer"],
      }),
    ],
  },
  {
    category: "overshirts",
    garment: "shirt",
    weightGrams: 450,
    sizes: "alpha",
    fabric: "Cotton twill, 300 GSM",
    products: [
      tee("Utility Overshirt", ["olive", "khaki"], 1999, 2799, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Twill Overshirt", ["black", "rust"], 1899, 2599, {
        fit: "boxy",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
    ],
  },
  {
    category: "hoodies",
    garment: "hoodie",
    weightGrams: 620,
    sizes: "alpha",
    fabric: "Cotton fleece, 380 GSM brushed back",
    products: [
      tee("Core Hoodie", ["black", "grey-melange", "navy"], 1499, 1999, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Zip-Up Hoodie", ["charcoal", "olive"], 1799, 2399, {
        fit: "regular",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Heavyweight Hoodie", ["off-white", "maroon"], 2199, 2999, {
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Graphic Back Hoodie", ["black", "lavender"], 1899, 2599, {
        sleeve: "full-sleeve",
        pattern: "graphic",
        tags: ["winter", "graphic"],
      }),
      tee("Washed Hoodie", ["acid-wash", "rust"], 1999, 2799, {
        sleeve: "full-sleeve",
        pattern: "washed",
        tags: ["winter"],
      }),
    ],
  },
  {
    category: "sweatshirts",
    garment: "sweatshirt",
    weightGrams: 520,
    sizes: "alpha",
    fabric: "French terry, 340 GSM",
    products: [
      tee("Crewneck Sweatshirt", ["grey-melange", "navy"], 1299, 1699, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Terry Sweatshirt", ["beige", "olive"], 1399, 1899, {
        fit: "relaxed",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
      tee("Varsity Sweatshirt", ["maroon", "off-white"], 1599, 2199, {
        sleeve: "full-sleeve",
        pattern: "graphic",
        tags: ["winter", "graphic"],
      }),
      tee("Half-Zip Sweatshirt", ["black", "charcoal"], 1699, 2299, {
        fit: "regular",
        sleeve: "full-sleeve",
        tags: ["winter"],
      }),
    ],
  },
  {
    category: "jeans",
    garment: "pants",
    weightGrams: 720,
    sizes: "waist",
    fabric: "Cotton denim with 1% elastane, 12 oz",
    products: [
      tee("Straight Fit Jeans", ["indigo", "black"], 1799, 2499, {
        fit: "regular",
      }),
      tee("Relaxed Fit Jeans", ["light-blue", "indigo"], 1899, 2599, {
        fit: "relaxed",
      }),
      tee("Slim Taper Jeans", ["black", "charcoal"], 1799, 2399, {
        fit: "slim",
      }),
      tee("Baggy Jeans", ["acid-wash", "light-blue"], 1999, 2799, {
        fit: "relaxed",
        pattern: "washed",
      }),
      tee("Carpenter Jeans", ["indigo", "khaki"], 2099, 2899, {
        fit: "relaxed",
      }),
    ],
  },
  {
    category: "trousers",
    garment: "pants",
    weightGrams: 520,
    sizes: "waist",
    fabric: "Cotton twill",
    products: [
      tee("Pleated Trousers", ["beige", "black"], 1599, 2199, {
        fit: "relaxed",
      }),
      tee("Cargo Pants", ["olive", "khaki", "black"], 1699, 2299, {
        fit: "relaxed",
      }),
      tee("Slim Chinos", ["khaki", "navy"], 1399, 1899, { fit: "slim" }),
      tee("Parachute Pants", ["black", "olive"], 1599, 2199, {
        fit: "relaxed",
      }),
    ],
  },
  {
    category: "shorts",
    garment: "shorts",
    weightGrams: 320,
    sizes: "waist",
    fabric: "Cotton twill",
    products: [
      tee("Cargo Shorts", ["olive", "khaki"], 899, 1199, {
        fit: "relaxed",
        tags: ["summer"],
      }),
      tee("Denim Shorts", ["light-blue", "indigo"], 999, 1299, {
        fit: "regular",
        tags: ["summer"],
      }),
      tee("Terry Shorts", ["grey-melange", "black"], 799, 1099, {
        fit: "relaxed",
        tags: ["summer"],
      }),
    ],
  },
  {
    category: "joggers",
    garment: "pants",
    weightGrams: 460,
    sizes: "alpha",
    fabric: "Cotton fleece, 320 GSM",
    products: [
      tee("Core Joggers", ["black", "grey-melange"], 1099, 1499, {
        fit: "relaxed",
      }),
      tee("Cargo Joggers", ["olive", "charcoal"], 1299, 1799, {
        fit: "relaxed",
      }),
      tee("Track Joggers", ["navy", "maroon"], 1199, 1599, { fit: "regular" }),
    ],
  },
]
