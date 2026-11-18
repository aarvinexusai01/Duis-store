# ADR-0035: The admin helper (corner cat)

- Status: Accepted (owner decisions, 2026-11-14; extended 2026-11-17)
- Date: 2026-11-14

## Context

The owner wants the admin to be friendlier for staff who aren't technical, with a mascot that guides them. The `page-mascot` package (MIT) draws a character whose head follows the cursor and pulls a face when clicked. It has no tips, tours or checklists, and code can't set its face.

## Decision

1. **Where.** A cat ("Miso") sits in the bottom-right corner of every admin page. Clicking it opens a panel. The admin's `<main>` has extra bottom padding, and the product form's sticky save bar is padded on the right, so the cat never covers a control.
2. **The component is adapted, not installed.** `src/features/helper/ui/mascot.tsx` is page-mascot 0.1.0 with a `mood` prop, pass-through button props (so it can be the popover trigger) and Tailwind classes. The MIT notice is kept in the file and in `mascot.LICENSE`. The two sprite sheets are in `public/mascots/`.
3. **What it says.**
   - **Tips for each page:** `src/features/helper/tips.ts`, matched by path with `*` for ids. A unit test fails if a menu page has no tips.
   - **Getting-started checklist:** each step is done when the store's data says so (a category exists, a receive movement exists, and so on). It shows only the steps the person's role can do. It is store-wide, not personal.
   - **First-visit tour:** up to 8 steps, skipping any whose target isn't on screen (for example, sidebar links on a phone). Escape or "Skip tour" ends it. It can be replayed from the panel.
4. **Reactions.** The helper watches the admin's existing sonner toasts (`data-type` on `[data-sonner-toast]`), so no page code changes: sparkle, delighted or heart on success, dizzy on error, surprised on a warning. It falls asleep after 2 minutes without activity. Bounces respect `prefers-reduced-motion`.
5. **Settings per person.** `staff_preferences` (one row per staff member, created on first change) holds `helper_hidden` and `tour_completed_at`, so the choice follows the person across devices. These are personal UI settings, so they're not written to the audit log.
6. **Tests.** E2E staff accounts have the tour, page tours and walkthrough marked as seen, so nothing covers the page in other tests. `createStaff(page, role, { tour: true })` or `{ guides: true }` opts back in.

## Extension (owner decisions, 2026-11-17)

7. **Product walkthrough** (`ui/walkthrough.ts`). Eighteen steps across New product and the product it creates: a 'before you start' note, name, category, Colour then Size, description, weight, Create; then Variants & stock, Generate, stock; then Photos, upload, tag each photo's colour, save; then Ready to sell?, Publish, View in store, and a pointer to Collections. Sizes come before photos because a photo can only be tagged with a colour the product already has. Unlike the tours it doesn't block the page: the next control is outlined, and each step moves on by itself once the page shows it's done (a field filled, a tab open, a row created), or on Next. It's offered on New product until finished once (or declined), and is always in the panel. An unfinished walkthrough survives a reload in `sessionStorage` (this tab only).
8. **Product health check** (`health.ts`, pure, unit-tested). A "Ready to sell?" card on the product page. Blockers repeat what publishing already enforces (a photo, an active variant). Warnings never block (owner decision): nothing in stock, some sizes sold out, a colour without its own photo (only with two or more colours), no description, no size chart up the main category's tree. Each links to the tab or page that fixes it. Pressing Publish with something listed makes the cat point at the card.
9. **Daily to-do** (`todos.ts`, operation `helper.getTodos`). One query of counts, each line only for roles that can act on it (doc/permissions.md). It shows as a "Today" card at the top of the dashboard, a number on the cat, and a Today tab in the panel. It refreshes on each page change.
10. **A tour for every page** (`ui/page-tours.ts`). Every menu page, plus the product, order and page editors, has 1–5 steps after an opening step on the page title. Targets are `data-tour` attributes on shared parts (page header, data table) and a few components, or plain landmarks (`main table`, a labelled `nav`); missing targets are skipped. On a person's first visit to a page the cat offers it in a speech bubble that doesn't block anything; accepting, declining or closing marks it seen.
11. **Remembering guides.** `staff_preferences.seen_guides` (migration 0024) holds `product-walkthrough` and `page:<pattern>` keys, at most 200, validated by `GUIDE_KEY_PATTERN`.
12. **Speaking from anywhere.** Pages call `helperSay()` (`ui/say.ts`), a browser event, to show a short message above the cat, so they don't import the helper.
13. **Written guide** (owner request 2026-11-17). "How to add a product" at `/admin/help/add-product` (staff with `catalog:read`): one-time setup (category and HSN code, size chart, attaching it, colours and sizes), then details, sizes/prices/stock, photos, check and publish, and after publishing. Its words live in `add-product-guide.ts`, which the shareable printable copy is made from too, so they never disagree. It links from the Products page, New product and the cat's menu; "Start the walkthrough" hands over to the walkthrough (`startProductWalkthrough()`), and Print leaves out the menu, header and cat.
