import type { estypes } from "@elastic/elasticsearch"

/**
 * The product search index (ADR-0033). Changing anything here changes what's
 * stored, so bump MAPPING_VERSION: the worker then rebuilds the index in the
 * background on its next start and switches to it when it's complete.
 */
export const MAPPING_VERSION = 1

/**
 * Words customers use for the same thing. Applied when products are indexed
 * (not to the query), so typo tolerance still works on every search word.
 * Single words only: "t-shirt", "t shirt" and "track pants" are joined into
 * one word first (see JOIN_WORDS).
 */
export const SYNONYMS = [
  "tee, tees, tshirt, tshirts",
  "hoodie, hoodies, hoody, hooded",
  "sweatshirt, sweatshirts, crewneck",
  "jogger, joggers, trackpant, trackpants",
  "trouser, trousers, pant, pants",
  "jeans, denim, denims",
  "oversized, baggy, oversize",
]

const JOIN_WORDS = [
  { pattern: "(?i)\\bt[\\s-]?shirt", replacement: "tshirt" },
  { pattern: "(?i)\\btrack[\\s-]+pant", replacement: "trackpant" },
  { pattern: "(?i)\\bsweat[\\s-]+shirt", replacement: "sweatshirt" },
  { pattern: "(?i)\\bcrew[\\s-]+neck", replacement: "crewneck" },
]

const textField = {
  type: "text",
  analyzer: "duis_index",
  search_analyzer: "duis_search",
} as const

export const INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  // One node: a replica would never be assigned and the index stays yellow.
  number_of_replicas: 0,
  analysis: {
    char_filter: Object.fromEntries(
      JOIN_WORDS.map((rule, i) => [
        `join_${i}`,
        { type: "pattern_replace", ...rule },
      ]),
    ),
    filter: {
      duis_synonyms: { type: "synonym", synonyms: SYNONYMS },
      english_possessive: { type: "stemmer", language: "possessive_english" },
      english_stemmer: { type: "stemmer", language: "english" },
    },
    analyzer: {
      duis_index: {
        type: "custom",
        char_filter: JOIN_WORDS.map((_, i) => `join_${i}`),
        tokenizer: "standard",
        filter: [
          "lowercase",
          "asciifolding",
          "duis_synonyms",
          "english_possessive",
          "english_stemmer",
        ],
      },
      duis_search: {
        type: "custom",
        char_filter: JOIN_WORDS.map((_, i) => `join_${i}`),
        tokenizer: "standard",
        filter: [
          "lowercase",
          "asciifolding",
          "english_possessive",
          "english_stemmer",
        ],
      },
      duis_prefix: {
        type: "custom",
        char_filter: JOIN_WORDS.map((_, i) => `join_${i}`),
        tokenizer: "standard",
        filter: ["lowercase", "asciifolding"],
      },
    },
  },
}

export const INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: "strict",
  _meta: { version: MAPPING_VERSION },
  properties: {
    id: { type: "keyword" },
    // Ranked like Postgres search: title, then keywords, then description.
    title: {
      ...textField,
      copy_to: "all_text",
      fields: {
        // The search box: "overs" finds "Oversized…".
        prefix: { type: "search_as_you_type", analyzer: "duis_prefix" },
      },
    },
    subtitle: { ...textField, copy_to: "all_text" },
    // Category names, colour and other attribute labels, and tags.
    keywords: { ...textField, copy_to: "all_text" },
    description: { ...textField, copy_to: "all_text" },
    all_text: textField,
    filter_value_ids: { type: "keyword" },
    in_stock_value_ids: { type: "keyword" },
    min_price_paise: { type: "long" },
    max_price_paise: { type: "long" },
    max_discount_percent: { type: "integer" },
    in_stock: { type: "boolean" },
    published_at: { type: "date" },
    // The product card, shown as is: search pages never read Postgres.
    card: { type: "object", enabled: false },
  },
}

export type SearchDocument = {
  id: string
  title: string
  subtitle: string
  keywords: string
  description: string
  filter_value_ids: string[]
  in_stock_value_ids: string[]
  min_price_paise: number
  max_price_paise: number
  max_discount_percent: number
  in_stock: boolean
  published_at: string
  card: unknown
}
