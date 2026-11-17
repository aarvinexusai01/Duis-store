import type { TourStep } from "./tour-steps"

/**
 * "Show me around this page": a short tour per admin page, keyed by the same
 * patterns as the page tips (tips.ts). Steps whose target isn't on screen,
 * e.g. a button this role can't use, are skipped.
 */

const at = (
  targets: string[],
  title: string,
  body: string,
  mood: TourStep["mood"] = "wink",
): TourStep => ({ targets, title, body, mood })

const TITLE = ['[data-tour="page-title"]']
const ACTIONS = ['[data-tour="page-actions"]']
const FILTERS = ['[data-tour="list-filters"]']
const TABLE = ['[data-tour="list-table"]', "main table"]
const TOOLS = ['[data-tour="list-tools"]']

export const PAGE_TOURS: Record<string, TourStep[]> = {
  "/admin": [
    at(
      ['[data-tour="today"]'],
      "Today",
      "What needs you today. Each line opens the list behind it.",
      "sparkle",
    ),
    at(
      ['[data-tour="dashboard-cards"]'],
      "At a glance",
      "Sales for the last 30 days. Cards like To fulfil open the orders behind them.",
    ),
    at(
      ["main section:has(> h2)"],
      "Charts and lists",
      "Revenue per day, recent orders, best sellers and low stock.",
      "heart",
    ),
  ],

  // Sales
  "/admin/orders": [
    at(
      FILTERS,
      "Find an order",
      "Search by order number, customer, phone or tracking number, or filter by status.",
      "surprised",
    ),
    at(
      TABLE,
      "The orders",
      "Newest first. Open one to pack it and book the courier.",
      "sparkle",
    ),
    at(
      TOOLS,
      "Export and columns",
      "Download the list as a spreadsheet, or choose which columns show.",
    ),
  ],
  "/admin/orders/*": [
    at(
      TITLE,
      "One order",
      "Its status, items, customer and payment are all on this page.",
      "sparkle",
    ),
    at(
      ACTIONS,
      "Next steps",
      "Work top to bottom: mark it as packing, then book the parcel to get the label.",
    ),
    at(
      ["main h2"],
      "Sections",
      "Items, shipping, payment and staff notes. Notes are only seen by staff.",
      "heart",
    ),
  ],
  "/admin/orders/cod": [
    at(
      ['[data-tour="cod-import"]'],
      "Record a payout",
      "When the courier pays you cash-on-delivery money, record it here.",
      "sparkle",
    ),
    at(
      ["main table"],
      "Waiting and recorded",
      "Orders still waiting for the courier's payment, and payouts already recorded.",
    ),
  ],
  "/admin/exchanges": [
    at(
      FILTERS,
      "Find a request",
      "Filter by status. 'Requested' ones are waiting for your decision.",
      "surprised",
    ),
    at(
      TABLE,
      "Exchange requests",
      "Open one to see the photos and reason, then approve or reject.",
    ),
  ],
  "/admin/reviews": [
    at(
      ['nav[aria-label="Review status"]'],
      "To moderate",
      "New reviews wait here before they show in the shop.",
      "surprised",
    ),
    at(
      ["main ul", "main table"],
      "The reviews",
      "Publish honest reviews, good or bad. Reject only spam or abuse.",
      "heart",
    ),
  ],
  "/admin/customers": [
    at(FILTERS, "Find someone", "Search by name, email or phone.", "surprised"),
    at(
      TABLE,
      "Customers",
      "Open one to see their orders, addresses and wallet credit.",
    ),
  ],
  "/admin/messages": [
    at(
      ['nav[aria-label="Message status"]'],
      "New, replied, closed",
      "New messages from the contact form wait under New.",
      "surprised",
    ),
    at(
      ["main ul", "main table"],
      "The messages",
      "Reply by email, then mark it as replied so the team knows.",
    ),
  ],
  "/admin/data-requests": [
    at(
      ["main section:has(> h2)", "main h2"],
      "Deletions and privacy messages",
      "Acknowledge within 48 hours and finish within a month.",
      "surprised",
    ),
  ],
  "/admin/discounts": [
    at(
      ACTIONS,
      "New discount",
      "Make a code like WELCOME10, or an offer that applies by itself.",
      "sparkle",
    ),
    at(FILTERS, "Find a discount", "Search or filter by status.", "surprised"),
    at(TABLE, "Your discounts", "Open one to see how often it's been used."),
  ],

  // Catalogue
  "/admin/products": [
    at(
      ACTIONS,
      "New product",
      "Start here. Photos, sizes and stock come after the first save.",
      "sparkle",
    ),
    at(
      FILTERS,
      "Find a product",
      "Search by name or SKU, or filter drafts, live and archived.",
      "surprised",
    ),
    at(
      TABLE,
      "Your products",
      "Drafts aren't in the shop yet. Open one to finish and publish it.",
      "heart",
    ),
  ],
  "/admin/products/*": [
    at(
      ['[data-tour="health"]'],
      "Ready to sell?",
      "I check the product here: photos, stock, description and size chart.",
      "surprised",
    ),
    at(
      ['[data-tour="tab-details"]'],
      "Details",
      "Name, description, category and the legal details for the label.",
    ),
    at(
      ['[data-tour="tab-media"]'],
      "Photos",
      "Upload photos and tag each one with its colour.",
      "heart",
    ),
    at(
      ['[data-tour="tab-variants"]'],
      "Variants and stock",
      "Generate colours and sizes, set prices, and press Stock on a row to add more.",
      "sparkle",
    ),
    at(
      ['[data-tour="publish"]', ...ACTIONS],
      "Publish",
      "When it's ready, publish it to put it in the shop.",
      "delighted",
    ),
  ],
  "/admin/products/new": [
    at(
      ["#pf-title"],
      "Start with the name",
      "Name, category and colour/size options first. Photos come after you save.",
      "sparkle",
    ),
    at(
      ['[data-tour="variant-options"]'],
      "Options",
      "Tick Colour, then Size. These can't change after the product is created.",
      "surprised",
    ),
  ],
  "/admin/categories": [
    at(
      ['[data-tour="category-tree"]'],
      "The shop's menu",
      "Categories like Men → T-Shirts. Use the arrows to change the order.",
      "sparkle",
    ),
    at(
      ACTIONS,
      "Add a category",
      "Pick a parent to put one category under another.",
    ),
  ],
  "/admin/attributes": [
    at(
      ['[data-tour="attributes"]'],
      "Colours, sizes and filters",
      "Add a colour or size once here, and every product can use it.",
      "sparkle",
    ),
  ],
  "/admin/size-charts": [
    at(
      ['[data-tour="size-chart"]'],
      "A size chart",
      "These measurements show in the shop's size guide.",
      "sparkle",
    ),
    at(
      ACTIONS,
      "Use it",
      "Attach a chart to a category in Categories and all its products use it.",
    ),
  ],
  "/admin/collections": [
    at(
      ACTIONS,
      "New collection",
      "Hand-pick products, or set rules that fill it automatically.",
      "sparkle",
    ),
    at(
      ["main ul", "main table"],
      "Your collections",
      "Empty collections show nothing in the shop. Open one to add products.",
      "surprised",
    ),
  ],
  "/admin/inventory": [
    at(
      ['[data-tour="adjust-stock"]'],
      "Adjust",
      "When a delivery arrives, press Adjust and choose 'Received new stock'.",
      "sparkle",
    ),
    at(
      FILTERS,
      "Low stock",
      "Search by SKU or name, or show only what's running low.",
      "surprised",
    ),
    at(
      ACTIONS,
      "Movements",
      "Every stock change is recorded, with who made it.",
    ),
  ],

  // Content
  "/admin/cms": [
    at(
      ['nav[aria-label="Page views"]'],
      "Your pages",
      "The home page, landing pages and info pages. Drafts change nothing until published.",
      "sparkle",
    ),
    at(
      ACTIONS,
      "New page",
      "Start a page, add sections, then submit it for review.",
    ),
  ],
  "/admin/cms/pages/*": [
    at(
      ['[aria-label="Page sections"]'],
      "Sections",
      "The page is built from sections. Changes save by themselves as a draft.",
      "sparkle",
    ),
    at(
      ['[aria-label="Add a section"]'],
      "Add a section",
      "Banners, product rails, text, FAQs and more.",
    ),
    at(
      ['[aria-label="Preview size"]'],
      "Preview",
      "Check it on desktop and mobile before you submit it.",
      "heart",
    ),
  ],
  "/admin/cms/journal": [
    at(
      ['nav[aria-label="Story views"]'],
      "Stories",
      "Drafts, stories waiting for review, and published ones.",
      "sparkle",
    ),
    at(ACTIONS, "New story", "Write a story for /journal."),
  ],
  "/admin/cms/navigation": [
    at(
      ["main ul", "main table"],
      "Header and footer",
      "Open a menu to change its links. Changes are drafts until published.",
      "sparkle",
    ),
  ],
  "/admin/cms/settings": [
    at(
      ["main form", "main section"],
      "Site settings",
      "Brand, announcement bar, contact details and social links.",
      "sparkle",
    ),
  ],
  "/admin/media": [
    at(
      ACTIONS,
      "Upload",
      "Every uploaded image lives here. Upload once, use it anywhere.",
      "sparkle",
    ),
    at(
      ['nav[aria-label="Filter"]'],
      "Filter",
      "Show only images that are used, or unused ones you can tidy up.",
      "surprised",
    ),
  ],
  "/admin/cms/redirects": [
    at(
      ['[data-tour="redirect-form"]'],
      "Add a redirect",
      "Send an old web address to a new one so links don't break.",
      "sparkle",
    ),
    at(
      ["main table", "main ul"],
      "Your redirects",
      "Changing a product or page address adds one for you.",
    ),
  ],
  "/admin/cms/scheduled": [
    at(
      ["main table", "main ul", ...TITLE],
      "Going live soon",
      "Content set to publish by itself, in India time.",
      "sparkle",
    ),
  ],

  // Administration
  "/admin/reports": [
    at(
      ACTIONS,
      "Date range and export",
      "Choose the period, and export to a spreadsheet.",
      "sparkle",
    ),
    at(
      ["main section:has(> h2)", "main h2"],
      "The numbers",
      "Sales count from the day payment was confirmed.",
    ),
  ],
  "/admin/staff": [
    at(
      ['[data-tour="staff-invite"]'],
      "Invite a teammate",
      "Give each person only the role they need.",
      "sparkle",
    ),
    at(
      ["main table", "main ul"],
      "Your team",
      "Change someone's roles or remove their access here.",
    ),
  ],
  "/admin/audit": [
    at(
      FILTERS,
      "Search the log",
      "Find who changed what, by person, action or date.",
      "surprised",
    ),
    at(TABLE, "Every change", "Entries can't be edited or deleted."),
  ],
  "/admin/system": [
    at(
      ["main section:has(> h2)", "main h2"],
      "Jobs and webhooks",
      "Jobs retry by themselves. Only worry about ones listed as failed.",
      "sparkle",
    ),
  ],
  "/admin/settings": [
    at(
      ['nav[aria-label="Settings sections"]'],
      "Settings sections",
      "Shipping, cash on delivery, tax and policies. Jump to one here.",
      "sparkle",
    ),
    at(["main form"], "Save each section", "Changes apply to new orders only."),
  ],
}

/** Every tour also starts on the page title, so it says where you are. */
export function pageTour(pattern: string | null, title: string): TourStep[] {
  const steps = pattern ? PAGE_TOURS[pattern] : undefined
  if (!steps) return []
  return [
    at(TITLE, title, "A quick look at what's on this page.", "delighted"),
    ...steps,
  ]
}
