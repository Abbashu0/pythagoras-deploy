# Task: build-admin-manager-sections — Nav / Materials / Tools Managers

**Agent:** Z.ai Code (main agent, single-agent execution)
**Task ID:** build-admin-manager-sections
**Date:** 2025 rebuild

## Goal

Add three new admin manager sections to the Pythagoras Platform Next.js
app at `/home/z/my-project/src/app/admin/`:
- `/admin/navigation` — manage student-app bottom-nav items (5 entries).
- `/admin/materials` — manage student-app materials grid (8 subjects).
- `/admin/tools` — manage student-app tools list (5 tools).

Plus a shared layout component (`AdminPageLayout`) so the 4 admin pages
(Banners, Nav, Materials, Tools) don't duplicate the back-button /
title / theme-toggle / activity-history chrome.

## Files written

| File | Action | Purpose |
|---|---|---|
| `src/lib/admin/admin-store.ts` | Edit | Added `appendHistoryEntry(entry)` — public method so external stores (Nav, Materials, Tools) can log to the SHARED activity history (`pythagoras-admin-history`). The store owns the array, the cap (200), persistence, and the emit cycle. |
| `src/lib/admin/app-icons.tsx` | Create | React `<AppIcon name="…"/>` renderer + `APP_ICON_NAMES` list mirroring the student app's `public/pythagoras/src/scripts/icons.js` path definitions (30 icons). Unknown names fall back to `spark-grid`. |
| `src/lib/admin/nav-store.ts` | Create | `NavStore` class (singleton via `getNavStore()`). Holds `NavItem[]`, persists to `pythagoras-admin-nav-items`. Methods: `loadFromStorage`, `subscribe`/`getSnapshot`/`getServerSnapshot` for `useSyncExternalStore`, `commitNavEdit(id, patch, summary)`, `moveNavItem(id, dir)`. Routes activity entries through `getAdminStore().appendHistoryEntry(...)` with title prefix `التنقل: {label}`. |
| `src/lib/admin/use-nav-store.ts` | Create | `useNavStore()` hook — `useSyncExternalStore` wrapper around `getNavStore()`. |
| `src/lib/admin/content-store.ts` | Create | Generic `ContentStore` class instantiated twice via singletons: `getMaterialsStore()` (`pythagoras-admin-materials`, 8 subjects, logPrefix `مواد`) and `getToolsStore()` (`pythagoras-admin-tools`, 5 tools, logPrefix `أدوات`). Same API as `NavStore` but uses `available` instead of `enabled`. |
| `src/lib/admin/use-content-store.ts` | Create | `useMaterialsStore()` + `useToolsStore()` hooks. |
| `src/components/admin/IconPicker.tsx` | Create | Grid of all 30 student-app icons. Selected icon gets a primary-tinted ring + check badge. Calls `onChange(name)` immediately — parent uses this to mark the editor draft dirty. |
| `src/components/admin/AdminPageLayout.tsx` | Create | Shared chrome: back button (→ `/admin`), title + subtitle, theme toggle (Sun/Moon), 3-column grid (list / editor / `ActivityHistory` sticky), full-width bottom preview slot. Loads AdminStore on mount + applies the `dark` class to `<html>` reactively. Accepts `list`, `editor`, `preview` ReactNode props. |
| `src/components/admin/SimpleListItem.tsx` | Create | One row in the reorderable list. Position number + icon + label + enabled badge + move up/down + edit button. Applies `admin-banner-card admin-reorder-item` classes + expects a `data-flip-key` wrapper from the parent for FLIP. |
| `src/components/admin/SimpleItemEditor.tsx` | Create | Shared editor for nav / materials / tools. Pending-save pattern (idle → saving → saved → error). Fields: label input, `<IconPicker>`, enable/disable switch. `enabledField` prop selects between `enabled` (nav) and `available` (materials/tools). Notifies parent of the draft via `onDraftChange(draft)` for the live preview. |
| `src/components/admin/LiveBottomNavPreview.tsx` | Create | Mock phone bottom-nav bar. Shows all items horizontally with their current draft icons + labels. Disabled items dimmed. Active item highlighted. |
| `src/components/admin/LiveCardGridPreview.tsx` | Create | Mock student-app card grid (materials) OR list (tools). `variant="grid"` for materials, `variant="list"` for tools. Unavailable items dimmed + show "معطّل" badge. |
| `src/app/admin/navigation/page.tsx` | Create | Full navigation manager page. Uses `<AdminPageLayout>` + `<SimpleListItem>` (with FLIP) + `<SimpleItemEditor>` + `<LiveBottomNavPreview>`. |
| `src/app/admin/materials/page.tsx` | Create | Full materials manager. Same layout, preview uses `<LiveCardGridPreview variant="grid">`. |
| `src/app/admin/tools/page.tsx` | Create | Full tools manager. Same layout, preview uses `<LiveCardGridPreview variant="list">`. Tools that aren't available show a "قريبًا" trailing badge in the list (matching the student app). |
| `src/app/admin/page.tsx` | Edit | Dashboard SECTIONS array now exposes 4 available sections: banners (ImagePlus), navigation (Compass), materials (BookOpen), tools (Wrench). Remaining 4 sections (icons, questions, lectures, settings) stay unavailable. |

## Implementation notes

### Shared activity log architecture

The banner store owned the activity history (loaded + persisted to
`pythagoras-admin-history`). The new managers needed to log to the SAME
history so the right-hand `<ActivityHistory>` panel shows entries from
every sub-system.

**Solution:** added a public `appendHistoryEntry(entry)` method to
`AdminStore`. External stores (Nav, Materials, Tools) call this with an
entry that's missing `id` + `at` — AdminStore generates those, prepends
to its history array, caps at 200, persists, and emits.

This keeps a single source of truth for the activity log (AdminStore)
and avoids race conditions where two stores would each maintain their
own copy of the history array and overwrite each other on persist.

Entry titles are prefixed so the activity log distinguishes them:
- Banner edits: `مراجعة الأحياء` (the banner's title)
- Nav edits: `التنقل: الرئيسية`
- Materials edits: `مواد: الأحياء`
- Tools edits: `أدوات: بومودورو`
- Carousel settings: `إعدادات الكاروسيل`

### Pending-save pattern (mirrors `BannerEditor`)

`SimpleItemEditor` implements the same state machine as `BannerEditor`:
- Local `draft` state holds the working copy (typed changes don't hit
  the store until the user clicks Save).
- `dirty` Set computed by diffing the draft against the committed item
  (reverting a field back to its original value drops it from the dirty
  set automatically).
- Save bar only appears when `dirty.size > 0`.
- Save flow: `idle → saving` (900ms simulated latency) → `saved` (2s
  green) → `idle`, or `→ error` (3s red) → `idle`.
- The parent's `<LiveBottomNavPreview>` / `<LiveCardGridPreview>` overlays
  the unsaved draft onto the committed list so the preview reflects
  edits in real-time.

Same "adjust state during render" pattern (calling `setState` during
render when a prop change is detected) used by `BannerEditor` to sync
the draft when the selected item ID changes — avoids
`react-hooks/set-state-in-effect`.

### Defensive selection-reset (no `set-state-in-effect`)

Each manager page defensively clears `selectedId` if the selected item
disappears (future-proofing for a delete feature). The natural way to
write that is a `useEffect`, but that triggers the
`react-hooks/set-state-in-effect` lint rule.

Refactored to the "adjust state during render" pattern (same as
`BannerEditor`'s prop-change sync):

```tsx
const selectedStillExists = selectedId
  ? navItems.some((i) => i.id === selectedId)
  : true;
const [trackedExists, setTrackedExists] = useState(true);
if (selectedStillExists !== trackedExists) {
  setTrackedExists(selectedStillExists);
  if (!selectedStillExists) setSelectedId(null);
}
```

### FLIP animation

Each manager page uses `useFlipReorder(listRef, sortedIds, 300)`. The
dependency array is the sorted ids array (wrapped in a single-element
array internally by the hook) so the FLIP effect only re-runs when an
actual reorder happens — not on every keystroke in the editor.

Each list row is wrapped in `<div data-flip-key={item.id}>` so the
FLIP hook can match children across renders.

### Theme handling

`AdminPageLayout` subscribes to `useAdminStore()` and reads `adminTheme`
reactively (no local mirror state). One `useEffect` calls
`store.loadFromStorage()` on mount (idempotent — also loads the
manager's own list store via the `loadStore` prop). A second `useEffect`
toggles the `dark` class on `document.documentElement` — pure
external-system sync, no setState, satisfies the lint rule.

The toggle button calls `store.setAdminTheme(...)` — the store emits
and the icon + `<html>` class flip reactively on the next render.

### Icon picker

`IconPicker` renders all 30 student-app icons as a 6×N (mobile) /
8×N (sm+) grid of square buttons. The selected icon gets
`border-primary bg-primary/10 ring-1 ring-primary/40` + a small check
badge in the corner. Clicking an icon calls `onChange(name)` immediately
— the editor's `updateField("icon", name)` marks the draft dirty and
the live preview updates instantly.

### Live previews

- `LiveBottomNavPreview`: a phone-width (max-w-sm) horizontal bar
  showing all 5 nav items with their draft icons + labels. Disabled
  items dimmed. Active item highlighted. Centered in a muted container.

- `LiveCardGridPreview`: a responsive 2×N / 4×N card grid for
  materials, or a vertical list for tools (matching the student app's
  distinct layouts). Unavailable items dimmed + show "معطّل" badge.

Both previews accept the editor's `EditableItem` draft (with optional
`enabled`/`available`) — typed loosely so the editor's draft can be
overlaid onto the committed list without manual field-name remapping.

## Lint result

```
$ bun run lint

/home/z/my-project/public/pythagoras/src/components/SponsoredCarouselCard.js
   88:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
   96:7  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
  109:7  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
  362:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')

✖ 4 problems (0 errors, 4 warnings)
```

All 4 warnings are pre-existing in `public/pythagoras/...` (the student
app's vanilla JS, unrelated to this task). Zero errors.

## Cross-references for future agents

- `src/lib/admin/admin-store.ts` — added `appendHistoryEntry(entry)` to
  the public API. Use this from any future admin sub-system that needs
  to log to the shared activity history.
- `src/lib/admin/nav-store.ts` / `src/lib/admin/content-store.ts` — the
  pattern to follow for any future list-based manager (e.g.
  `/admin/lectures`, `/admin/announcements`). Both follow the same
  architecture: plain JS class, `loadFromStorage` called from useEffect,
  `subscribe`/`getSnapshot`/`getServerSnapshot` for
  `useSyncExternalStore`, mutations route activity entries through
  `getAdminStore().appendHistoryEntry(...)`.
- `src/components/admin/AdminPageLayout.tsx` — drop-in chrome for any
  new admin page. Just pass `title`, `subtitle`, `loadStore`,
  `list`, `editor`, `preview` ReactNode props.
- `src/components/admin/SimpleItemEditor.tsx` — drop-in editor for any
  item with `{ id, label, icon, enabled|available, order }` shape. The
  `enabledField` prop adapts it to either field name.
- `src/components/admin/SimpleListItem.tsx` — drop-in list row. Just
  wrap it in `<div data-flip-key={item.id}>` and use `useFlipReorder`.
- `src/lib/admin/app-icons.tsx` — keep this in sync with
  `public/pythagoras/src/scripts/icons.js` whenever the student app
  adds a new icon. The `APP_ICON_NAMES` list drives the IconPicker grid.
- The student app does NOT yet read from these new stores (nav,
  materials, tools). That's a future task — when ready, update
  `public/pythagoras/src/scripts/data.js` to lazy-load from
  localStorage on app boot, falling back to the hardcoded defaults if
  the keys are missing.
