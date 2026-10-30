import type { NavigationData, PageData, SiteSettingsData } from "@/features/cms"
import { paragraphs } from "@/lib/rich-text"

/** Demo CMS content. Every link target is a real seeded row. */

type Ids = {
  categories: Record<string, string>
  collections: Record<string, string>
  heroMedia: string[]
  promoMedia: string[]
}

export function homepage(ids: Ids): PageData {
  const c = ids.collections
  return {
    sections: [
      {
        id: "hero",
        type: "hero_banner",
        enabled: true,
        slides: [
          {
            mediaId: ids.heroMedia[0]!,
            heading: "The Oversized Edit",
            subheading:
              "Heavyweight cotton, dropped shoulders, zero apologies.",
            cta: {
              label: "Shop oversized",
              href: "/collections/oversized-essentials",
            },
            textTone: "light",
          },
          {
            mediaId: ids.heroMedia[1]!,
            heading: "Graphic Drop 01",
            subheading: "Ten new prints. Limited runs.",
            cta: { label: "See the drop", href: "/collections/graphic-drop" },
            textTone: "light",
          },
        ],
      },
      {
        id: "categories",
        type: "category_showcase",
        enabled: true,
        heading: "Shop by category",
        categoryIds: [
          "oversized-t-shirts",
          "graphic-t-shirts",
          "polo-t-shirts",
          "shirts",
          "hoodies-and-sweatshirts",
          "jeans",
        ].map((slug) => ids.categories[slug]!),
      },
      {
        id: "featured",
        type: "featured_collections",
        enabled: true,
        heading: "Featured collections",
        collectionIds: [
          c["oversized-essentials"]!,
          c["graphic-drop"]!,
          c["winter-layers"]!,
        ],
        layout: "grid",
      },
      {
        id: "new-arrivals",
        type: "product_rail",
        enabled: true,
        heading: "New arrivals",
        source: { type: "new_arrivals" },
        limit: 12,
        cta: { label: "View all", href: "/collections/new-arrivals" },
      },
      {
        id: "best-sellers",
        type: "product_rail",
        enabled: true,
        heading: "Best sellers",
        source: { type: "collection", collectionId: c["best-sellers"]! },
        limit: 12,
      },
      {
        id: "promos",
        type: "promo_banner_grid",
        enabled: true,
        banners: [
          {
            mediaId: ids.promoMedia[0]!,
            heading: "Everything under ₹999",
            href: "/collections/under-999",
          },
          {
            mediaId: ids.promoMedia[1]!,
            heading: "The Denim Edit",
            href: "/collections/denim-edit",
          },
        ],
      },
      {
        id: "trending",
        type: "product_rail",
        enabled: true,
        heading: "Trending now",
        source: { type: "collection", collectionId: c["trending-now"]! },
        limit: 8,
      },
      {
        id: "story",
        type: "brand_story",
        enabled: true,
        heading: "Loud basics. Louder graphics.",
        content: paragraphs(
          "Duis makes streetwear for people who would rather be noticed. Heavyweight fabrics, oversized cuts and graphics that start conversations.",
          "Designed in India, made in small runs, shipped to your door.",
        ),
        mediaId: ids.promoMedia[2],
        cta: { label: "Our story", href: "/about" },
      },
      {
        id: "newsletter",
        type: "newsletter",
        enabled: true,
        heading: "Get first dibs on drops",
        subheading: "New releases, restocks and members-only offers. No spam.",
      },
    ],
    seo: {
      title: "Duis — Oversized Tees, Graphic Tees & Streetwear for Men",
      description:
        "Shop oversized and graphic t-shirts, shirts, hoodies and denim for men. Free shipping above ₹999.",
    },
  }
}

export function headerNavigation(ids: Ids): NavigationData {
  const cat = (
    slug: string,
    label: string,
    children?: NavigationData["items"],
  ) => ({
    id: slug,
    label,
    link: { type: "category" as const, categoryId: ids.categories[slug]! },
    ...(children ? { children } : {}),
  })
  const col = (slug: string, label: string, badge?: string) => ({
    id: `collection-${slug}`,
    label,
    link: { type: "collection" as const, collectionId: ids.collections[slug]! },
    ...(badge ? { badge } : {}),
  })
  return {
    items: [
      {
        id: "men",
        label: "Men",
        link: { type: "url", href: "/shop/men" },
        children: [
          cat("t-shirts", "T-Shirts", [
            cat("oversized-t-shirts", "Oversized"),
            cat("regular-fit-t-shirts", "Regular Fit"),
            cat("graphic-t-shirts", "Graphic"),
            cat("polo-t-shirts", "Polos"),
          ]),
          cat("shirts", "Shirts", [
            cat("casual-shirts", "Casual"),
            cat("linen-shirts", "Linen"),
            cat("overshirts", "Overshirts"),
          ]),
          cat("hoodies-and-sweatshirts", "Hoodies & Sweatshirts", [
            cat("hoodies", "Hoodies"),
            cat("sweatshirts", "Sweatshirts"),
          ]),
          cat("bottomwear", "Bottomwear", [
            cat("jeans", "Jeans"),
            cat("trousers", "Trousers"),
            cat("shorts", "Shorts"),
            cat("joggers", "Joggers"),
          ]),
        ],
      },
      col("new-arrivals", "New Arrivals", "New"),
      {
        id: "collections",
        label: "Collections",
        link: { type: "url", href: "/collections" },
        children: [
          col("oversized-essentials", "Oversized Essentials"),
          col("graphic-drop", "Graphic Drop"),
          col("winter-layers", "Winter Layers"),
          col("summer-essentials", "Summer Essentials"),
          col("under-999", "Under ₹999"),
        ],
      },
      col("best-sellers", "Best Sellers"),
    ],
  }
}

export function footerNavigation(): NavigationData {
  const page = (slug: string, label: string) => ({
    id: slug,
    label,
    link: { type: "page" as const, slug },
  })
  return {
    items: [
      {
        id: "help",
        label: "Help",
        link: { type: "page", slug: "contact" },
        children: [
          page("contact", "Contact us"),
          page("faq", "FAQ"),
          page("shipping-policy", "Shipping"),
          page("exchange-policy", "Exchanges"),
          page("size-guide", "Size guide"),
        ],
      },
      {
        id: "company",
        label: "Company",
        link: { type: "page", slug: "about" },
        // Every indexable page needs a link to it (Phase 11 crawl).
        children: [
          page("about", "About Duis"),
          {
            id: "journal",
            label: "Journal",
            link: { type: "url", href: "/journal" },
          },
          {
            id: "shop-all",
            label: "Shop all",
            link: { type: "url", href: "/shop" },
          },
        ],
      },
      {
        id: "legal",
        label: "Legal",
        link: { type: "page", slug: "terms-of-service" },
        children: [
          page("privacy-policy", "Privacy policy"),
          page("terms-of-service", "Terms of service"),
          page("cancellation-policy", "Cancellations"),
        ],
      },
    ],
  }
}

export function siteSettings(): SiteSettingsData {
  return {
    brandName: "Duis",
    tagline: "Loud basics. Louder graphics.",
    announcement: {
      enabled: true,
      text: "Free shipping on orders above ₹999 · Easy 10-day size exchanges",
      href: "/policies/shipping-policy",
    },
    contact: {
      email: "hello@duis.example",
      hours: "Mon–Sat, 10 am – 7 pm IST",
    },
    social: {},
    defaultSeo: {
      title: "Duis — Men's Streetwear",
      description:
        "Oversized tees, graphic tees, shirts, hoodies and denim for men. Shipping across India and worldwide.",
    },
  }
}

const PLACEHOLDER =
  "Placeholder text for development. Replace with lawyer-reviewed content before launch (doc/10, item A13)."

export const STATIC_PAGES: {
  slug: string
  title: string
  type: "static" | "policy"
  body: string[]
}[] = [
  {
    slug: "about",
    title: "About Duis",
    type: "static",
    body: [
      "Duis started with one question: why do basics have to be boring?",
      "We make heavyweight, oversized essentials and graphic tees in small runs, designed in India for people who dress to be noticed.",
    ],
  },
  {
    slug: "contact",
    title: "Contact us",
    type: "static",
    body: [
      "Questions about an order, sizing or an exchange? Write to hello@duis.example — we reply within one working day.",
    ],
  },
  {
    slug: "size-guide",
    title: "Size guide",
    type: "static",
    body: [
      "Measure a t-shirt you love, flat, across the chest and from shoulder to hem, then compare with the chart on each product page.",
      "Oversized styles are cut roomy on purpose: size down for a closer fit.",
    ],
  },
  {
    slug: "privacy-policy",
    title: "Privacy policy",
    type: "policy",
    body: [PLACEHOLDER],
  },
  {
    slug: "terms-of-service",
    title: "Terms of service",
    type: "policy",
    body: [PLACEHOLDER],
  },
  {
    slug: "shipping-policy",
    title: "Shipping policy",
    type: "policy",
    body: [
      PLACEHOLDER,
      "Configured today: free shipping in India on orders of ₹999 or more; below that, the courier's rate for your PIN code. International orders are prepaid.",
    ],
  },
  {
    slug: "exchange-policy",
    title: "Exchange policy",
    type: "policy",
    body: [
      PLACEHOLDER,
      "Configured today: size or colour exchanges within 10 days of delivery, up to two per item, with free reverse pickup. Innerwear cannot be exchanged.",
    ],
  },
  {
    slug: "cancellation-policy",
    title: "Cancellation policy",
    type: "policy",
    body: [
      PLACEHOLDER,
      "Configured today: orders can be cancelled until they are dispatched.",
    ],
  },
]

export const FAQ = [
  {
    question: "When will my order arrive?",
    answer:
      "It depends on your PIN code. Enter it on any product page to see the courier's estimate before you order.",
  },
  {
    question: "Can I exchange for a different size?",
    answer:
      "Yes — request a size or colour exchange from your account within 10 days of delivery. Reverse pickup is free.",
  },
  {
    question: "Do you offer cash on delivery?",
    answer:
      "Yes, in India: pay ₹100 online when you order and the rest in cash on delivery, for orders up to ₹2,500.",
  },
  {
    question: "Do you ship outside India?",
    answer:
      "Yes. International orders are paid online in INR; your card provider converts the amount.",
  },
]
