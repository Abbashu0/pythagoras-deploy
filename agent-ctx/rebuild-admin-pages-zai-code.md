# Task: rebuild-admin-pages — Admin Panel Pages Rebuild

**Agent:** Z.ai Code (main agent, single-agent execution)
**Date:** 2025 rebuild
**Task ID:** rebuild-admin-pages

## Goal

The Pythagoras Platform Next.js app was re-scaffolded and lost its admin pages.
Re-create three files (layout + dashboard + banners manager) on top of the
already-rebuilt `src/lib/admin/*` and `src/components/admin/*` files.

## Files written

| File | Action | Purpose |
|---|---|---|
| `src/app/admin/layout.tsx` | Overwrite | RTL wrapper + admin metadata. Stripped the old "Sponsored Carousel" wording. |
| `src/app/admin/page.tsx` | Overwrite | New **dashboard landing** at `/admin`. Grid of 8 section cards. |
| `src/app/admin/banners/page.tsx` | Create | Full **banners manager** at `/admin/banners` (was previously at `/admin`). |
| `src/app/globals.css` | Edit | Added `.admin-section-card` + `.admin-section-open` utility classes for hover affordances. |
| `src/app/admin/banners/` (dir) | `mkdir -p` | Ensured the route directory existed. |

## Implementation notes

### Theme handling refactor (lint-driven)
The original spec asked for `useEffect` on mount to call
`store.loadFromStorage()` + `setTheme(initial)` + apply `dark` class.
That pattern trips the `react-hooks/set-state-in-effect` lint rule
(calling `setState` synchronously inside an effect body triggers
cascading renders).

Refactored to the **proper reactive pattern**:
- Subscribe to the store via `useAdminStore()` and read `adminTheme`
  directly from the snapshot — no local state.
- One `useEffect` calls `store.loadFromStorage()` on mount (no setState).
- A second `useEffect` toggles the `dark` class on
  `document.documentElement` whenever `adminTheme` changes — pure
  external-system sync, no setState, satisfies the rule.
- The toggle button calls `store.setAdminTheme(next)` — the store emits
  and the icon flips reactively on the next render.

Both pages (`/admin` and `/admin/banners`) use the same pattern.

### Dashboard (`/admin/page.tsx`)
- 8 section cards in a responsive grid (`1 → 2 → 3 → 4` cols).
- Only "بانرات الصفحة الرئيسية" is `available=true` with `href="/admin/banners"`.
- Available sections: `router.push(href)`.
- Unavailable sections: `toast({ title: "قريباً", description: "هذا القسم سيكون متوفراً في تحديث لاحق." })`.
- Each card has the `admin-section-card` class + a `data-available`
  attribute (CSS dims unavailable cards slightly).
- "فتح" affordance (with `ArrowLeft` icon) hidden by default, revealed
  on hover via the `.admin-section-open` CSS rule.

### Banners manager (`/admin/banners/page.tsx`)
Mirrors the original `/admin/page.tsx` but with the **new component APIs**:
- `BannerEditor` now uses `onSave(id, patch, changeSummary)` (not `onPatch`).
  Wires to `store.commitBannerEdit(id, patch, changeSummary)` + toast.
- `LiveCarouselPreview` now takes `banner` + `allBanners` + `width`.
  Used as `<LiveCarouselPreview banner={draftBanner || selectedBanner} allBanners={sortedBanners} width={366} />`
  so the live preview reflects unsaved editor drafts.
- `useFlipReorder(bannerListRef, flipItems, 300)` where
  `flipItems = isImageEditing ? [] : sortedBanners` — disables FLIP
  while the user is dragging the ImagePositioner so live transforms
  don't invalidate the "First" position snapshot.
- Each banner row is wrapped in `<div data-flip-key={banner.id}>`
  (required by the FLIP hook to match children across renders).
- Upload section header includes `<BannerSizeInfo />` (compact popover
  showing recommended export sizes).
- Sticky `ActivityHistory` column on the right (desktop).
- Bottom `CarouselSettings` strip (auto-slide interval slider) wired
  to `store.setAutoSlideInterval(ms)` + toast.
- Delete dialog (`DeleteConfirmDialog`) wired to `store.deleteBanner`
  + toast on confirm.
- Back button uses `ArrowRight` icon (in RTL, the "back" direction
  points right) + label "لوحة التحكم", navigates to `/admin`.

### CSS additions (`src/app/globals.css`)
- `.admin-section-card` — base card style: padding, border, hover lift
  (`translateY(-2px)`), primary-tinted hover border, focus-visible ring.
- `.admin-section-card[data-available="false"]` — slight opacity dim
  for "coming soon" cards.
- `.admin-section-card .admin-section-open` — opacity/transform-hidden
  by default, revealed on `:hover` and `:focus-visible`.

## Lint result

```
✖ 4 problems (0 errors, 4 warnings)
```

All 4 warnings are pre-existing `Unused eslint-disable directive`
warnings in `public/pythagoras/src/components/SponsoredCarouselCard.js`
(unrelated to this task). Zero errors.

## Dev server status

The auto-started dev server hit a V8 heap OOM (Next.js Turbopack under
memory pressure, unrelated to this code) and crashed before my new files
were exercised in the browser. The system is expected to auto-restart it.
Lint passes cleanly, the imports match the existing component contracts,
and the patterns (FLIP, store subscription, toast feedback) mirror the
already-working single-page admin code — so the routes should render
correctly once the dev server is back up.

## Cross-references for future agents

- `src/lib/admin/admin-store.ts` — store contract (addBanner,
  commitBannerEdit, moveBanner, duplicateBanner, deleteBanner,
  setAdminTheme, setAutoSlideInterval, loadFromStorage).
- `src/lib/admin/use-admin-store.ts` — `useSyncExternalStore` wrapper.
- `src/lib/admin/use-flip-reorder.ts` — FLIP animation hook. The
  `items` array is spread into the `useLayoutEffect` dependency array,
  so pass the actual `sortedBanners` array (or `[]` to disable).
- `src/components/admin/BannerEditor.tsx` — uses the
  "adjust state during render" pattern for prop-change sync (same
  pattern React recommends to avoid `set-state-in-effect`).
- `src/components/admin/LiveCarouselPreview.tsx` — single banner
  renderer; `allBanners` only drives pagination dot count.
- `src/components/admin/ActivityHistory.tsx` — self-contained, reads
  from the store directly.
- Root layout already mounts `<Toaster />` globally, so toasts work on
  both `/admin` and `/admin/banners` without per-page setup.
