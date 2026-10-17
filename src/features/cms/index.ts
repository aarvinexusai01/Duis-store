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
  adminListPages,
  getPageEditor,
  listPageRevisions,
  listScheduled,
  loadEditorLabels,
  loadPreview,
  publishScheduled,
  type AdminPageRow,
  type PageEditorState,
  type PreviewPage,
  type RevisionSummary,
  type WorkflowStatus,
} from "./workflow"
