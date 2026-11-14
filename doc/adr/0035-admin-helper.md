# ADR-0035: The admin helper (corner cat)

- Status: Accepted (owner decisions, 2026-11-14)
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
6. **Tests.** E2E staff accounts have the tour marked as seen, so it doesn't cover the page in other tests. `createStaff(page, role, { tour: true })` opts back in.
