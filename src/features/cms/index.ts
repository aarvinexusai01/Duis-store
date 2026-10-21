// Public surface of the CMS module (doc/04 §7, rule 2). Cached storefront
// reads live in ./queries (Server Components only).
export {
  createPage,
  loadPublishedNavigation,
  loadPublishedPage,
  loadPublishedSiteSettings,
  publishRevision,
  saveNavigationDraft,
  savePageDraft,
  saveSiteSettingsDraft,
  type PublishedPage,
} from "./service"
export { blockSchema, type Block, type BlockType } from "./blocks"
export {
  navigationDataSchema,
  pageDataSchema,
  siteSettingsDataSchema,
  type NavigationData,
  type NavItem,
  type PageData,
  type SiteSettingsData,
} from "./schemas"
export {
  pageHref,
  resolveNavigation,
  resolvePageBlocks,
  type ResolvedBlock,
  type ResolvedNavItem,
} from "./resolve"
export {
  createPreviewLink,
  getEditor,
  listRevisions,
  listScheduled,
  loadPreview,
  publishScheduled,
  type EditorState,
  type PageEditorState,
  type PreviewPage,
  type RevisionSummary,
  type ScheduledItem,
  type WorkflowStatus,
} from "./workflow"
export {
  adminListPages,
  editorLabelsFor,
  loadEditorLabels,
  type AdminPageRow,
} from "./pages-admin"
export { MENU_KEYS, type ContentTarget, type MenuKey } from "./content-target"
export {
  JOURNAL_PAGE_SIZE,
  loadJournalFeed,
  resolvePostBody,
  type JournalCard,
  type JournalFilter,
  type JournalPost,
  type JournalTerm,
  type ResolvedPostBlock,
} from "./journal"
export {
  adminListPosts,
  getJournalTaxonomy,
  journalPath,
  type AdminPostRow,
  type JournalTaxonomy,
} from "./journal-admin"
export {
  blogPostDataSchema,
  type BlogPostData,
  type PostBlock,
  type PostBlockType,
} from "./journal-schemas"
