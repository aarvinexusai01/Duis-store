/**
 * Cache tag names (doc/02 §5). Cached reads tag themselves with these;
 * mutations request revalidation of the same tags.
 */
export const cacheTags = {
  product: (id: string) => `product:${id}`,
  productsList: "products:list",
  category: (id: string) => `category:${id}`,
  categoriesTree: "categories:tree",
  collection: (id: string) => `collection:${id}`,
  collectionsList: "collections:list",
  cmsPage: (slug: string) => `cms:page:${slug}`,
  cmsPagesList: "cms:pages",
  cmsNavigation: "cms:nav",
  cmsSettings: "cms:settings",
  journalPost: (slug: string) => `journal:post:${slug}`,
  journalList: "journal:list",
  media: (id: string) => `media:${id}`,
  storeSettings: "store:settings",
} as const

/** Tags are short ASCII identifiers; anything else is rejected on receipt. */
export const CACHE_TAG = /^[a-z][a-z0-9:_-]{0,127}$/i
