# Pythagoras Design System

Status: Active
Platform focus: Native Mobile
Current generation: V1
Last approved: 2026-08-30

This document describes the current approved Pythagoras Product design language. It is a living document: Product Owner decisions may evolve it, and a newer explicit Product decision overrides this document. It is not intended to freeze experimentation forever.

The current visual generation is internally described as **Pythagoras Warm Graphite**. It belongs to Pythagoras and is independent of any external product or brand.

## Source-of-Truth Priority

Use this order when product, design, and implementation guidance appear to disagree:

1. Product Owner explicit requirement.
2. `project-context.md`.
3. This document, `docs/product/DESIGN-SYSTEM.md`.
4. Current Expo SDK APIs/types and official Expo guidance.
5. Apple and Android platform conventions.
6. UI UX Pro Max critique.

The Design System must never override an explicit Product Owner decision.

## Visual Philosophy

Pythagoras is:

- calm and focused;
- premium but restrained;
- academic and content-first;
- Arabic-first and RTL-aware;
- native in interaction and navigation;
- comfortable for prolonged reading;
- low in visual noise;
- iOS-first in polish while remaining Android-correct.

Pythagoras is not pure-black-everywhere, harsh-white, neon, overly glassy, gradient-heavy, childish, a generic dashboard, or a card-inside-card composition by default.

Warm neutral surfaces, whitespace, small tonal differences, and semantic text hierarchy carry most of the visual identity. Color is reserved for interaction, status, and meaningful content.

## Runtime Token Source

The runtime palette source of truth is:

`mobile/src/theme.ts`

Product components should consume `getPalette(resolvedColorScheme)` rather than inventing per-screen neutral colors. Do not create a second TypeScript color-token source.

The runtime currently supports one user-visible theme, `default`, through the existing preferences provider. The palette changes with the resolved appearance mode; `themeId` remains stable.

## Semantic Color Tokens

The following values are the currently implemented tokens. They describe semantic roles, not screen-specific instructions.

### Dark

| Token | Value | Role |
|---|---|---|
| `background` | `#202020` | Product canvas / Level 0 |
| `surface` | `#181818` | Grouped section and primary card surface |
| `surfaceMuted` | `#2C2C2A` | Compatibility alias for elevated muted content |
| `surfaceElevated` | `#2C2C2A` | Badge, skeleton, elevated control, or highlighted internal surface |
| `surfaceInset` | `#131313` | Deep/inset field where a recessed level is useful |
| `surfacePressed` | `#242422` | Pressed state for custom surfaces |
| `text` | `#FAF9F5` | Primary text |
| `textSecondary` | `#B0AEA5` | Supporting text and labels |
| `textTertiary` | `#87867F` | Metadata, helper text, and quiet affordances |
| `border` | `#343432` | Subtle surface definition |
| `separator` | `#353533` | Inset grouped-row separator |
| `accent` | `#0A84FF` | General Pythagoras interactive accent |
| `selectionAccent` | `#0A84FF` | Selection and focused custom-state accent |
| `accentSoft` | `#193248` | Soft accent field |
| `accentText` | `#FFFFFF` | Text on an accent-colored control when required |
| `strongButton` | `#F9F9F7` | Strong neutral primary action surface |
| `strongButtonText` | `#1A1918` | Text on `strongButton` |
| `progressTrack` | `#3B3B39` | Quiet progress track |

### Light

| Token | Value | Role |
|---|---|---|
| `background` | `#FAF9F5` | Warm Product canvas / Level 0 |
| `surface` | `#F0EEE6` | Grouped section and primary card surface |
| `surfaceMuted` | `#F5F4ED` | Compatibility alias for elevated muted content |
| `surfaceElevated` | `#F5F4ED` | Badge, skeleton, elevated control, or highlighted internal surface |
| `surfaceInset` | `#E8E6DC` | Deep/inset field where a recessed level is useful |
| `surfacePressed` | `#E3E1D8` | Pressed state for custom surfaces |
| `text` | `#1A1918` | Primary text |
| `textSecondary` | `#5E5D59` | Supporting text and labels |
| `textTertiary` | `#87867F` | Metadata, helper text, and quiet affordances |
| `border` | `#DEDCD1` | Subtle surface definition |
| `separator` | `#D1CFC5` | Inset grouped-row separator |
| `accent` | `#007AFF` | General Pythagoras interactive accent |
| `selectionAccent` | `#007AFF` | Selection and focused custom-state accent |
| `accentSoft` | `#DDEBFA` | Soft accent field |
| `accentText` | `#FFFFFF` | Text on an accent-colored control when required |
| `strongButton` | `#1A1918` | Strong neutral primary action surface |
| `strongButtonText` | `#FAF9F5` | Text on `strongButton` |
| `progressTrack` | `#D1CFC5` | Quiet progress track |

`surfaceMuted` remains only as a compatibility alias for code that has not yet migrated. New Product code should choose `surface`, `surfaceElevated`, or `surfaceInset` by meaning.

There are currently no centralized `success` or `warning` tokens. Favorite/destructive feedback uses the platform semantic red on iOS and a scoped fallback on other platforms. These should become named tokens only when a stable Product need emerges.

## Surface Hierarchy

Pythagoras uses four contextual levels:

| Level | Meaning | Typical token |
|---|---|---|
| 0 | App/page canvas | `background` |
| 1 | Grouped section or large content surface | `surface` |
| 2 | Card, row, badge, or highlighted control | `surfaceElevated` or `surface` |
| 3 | Recessed field or focused/elevated internal treatment | `surfaceInset`, `surfaceElevated`, or native material |

These levels are not a mandate to use every shade on every screen. The goal is a small, perceptible hierarchy: background is not the same as card, and card is not automatically the same as an inset control.

Depth is primarily tonal. Dark Mode generally avoids visible drop shadows; Light Mode may use a restrained shadow only where it materially clarifies elevation.

## Grouped Sections

A section is appropriate when several controls belong to one conceptual group. It contains a coherent surface, shared corner treatment, comfortable internal spacing, and subtle separators when needed.

Do not wrap every heading, paragraph, icon, or badge in a card. Standalone artwork, banners, hero imagery, major primary actions, and the Question Reader can remain independent when their content role makes that clearer.

Current grouped-section examples:

- Settings root: one group for Information/FAQ/Support and a separate Appearance group.
- Appearance: one group for the three appearance choices, one Theme group, and one Font Size group.
- Material detail: one compact primary action and one grouped secondary-action surface.
- Question Bank: each Question Card is a quiet content surface on the Product canvas.

## Settings

Settings uses the native Stack title and native back behavior. Its grouped content surface is custom React Native because the Universal `FieldGroup`/SwiftUI `Form` owned an incompatible system background for the approved Warm Graphite canvas.

The current Settings root uses:

- `background` canvas;
- `surface` for each outer group;
- continuous approximately `28pt` group corners;
- approximately `24pt` screen horizontal inset;
- approximately `70pt` row minimum height;
- approximately `21pt` row horizontal padding;
- native `@expo/ui` icons hosted with native direction handling;
- full-row Pressable semantics;
- hairline `separator` lines inset from the group edges.

The custom grouping does not replace native navigation. Stack titles, native back, and platform navigation remain system-owned.

## Appearance

The Appearance page keeps the approved order:

1. `الوضع`
2. `الثيم`
3. `حجم الخط`

The three `تلقائي` / `الوضع النهاري` / `الوضع الليلي` controls belong to one outer grouped surface. Their frames remain stable when selection changes. Selection changes color through `selectionAccent`; it must not change border width, padding, size, scale, or position.

The current implementation uses approximately:

- outer appearance group radius `26pt` and padding `12pt`;
- mode tile radius `18pt` and fixed height `164pt`;
- inset mode tile surfaces;
- `selectionAccent` for the selected border with the same border width for every tile;
- warm light/dark mini-previews, with Automatic showing both modes.

The Theme section currently exposes only `الثيم الافتراضي`. Its swatches use the current palette and a hairline outline so dark and light swatches remain visible in either appearance. No additional themes are implied by the shell.

Font Size continues to use the real `@expo/ui` native Slider. The current app preference is an application multiplier with a default of `1.0`, a range of `0.85` to `1.15`, and `0.05` steps. The operating system's Dynamic Type/accessibility scaling remains separate and must not be disabled.

## Buttons and Controls

Button hierarchy is contextual:

- Primary actions may use `strongButton` with `strongButtonText` when a high-confidence neutral CTA is appropriate.
- Secondary actions use grouped surfaces or native controls.
- Tertiary actions remain quiet text/icon controls.
- Destructive actions use semantic system red and should not be confused with selection blue.
- Native circular actions use genuine native material where available.

The current Material primary action `اختبرني` is a compact approximately `80pt` high CTA, not a large light billboard. Its secondary actions are three non-rounded rows inside one grouped surface with inset separators.

Pressed states should preserve geometry. Custom controls may use `surfacePressed` or restrained opacity; they should not scale ordinary rows or cause neighboring layout to move.

## Corner and Border Language

Use `borderCurve: 'continuous'` where the platform supports it. Current approved corner families are approximate and role-based:

- small controls and internal tiles: `14–18pt`;
- grouped sections and action groups: `26–28pt`;
- Material image cards: `28pt`;
- Question Cards: `22pt`;
- Reader: transitions from the source card radius toward approximately `30pt`;
- Banner: `30pt`;
- circular controls and capsules: fully rounded.

These values are current implementation references, not permission to normalize every existing screen.

Borders should be hairline and low contrast. Use them when surface contrast is insufficient, when selection needs a stable state cue, or when a floating control needs definition. Grouped list separators are inset where appropriate and use the semantic `separator` token.

## Spacing and Insets

The current approved rhythm uses a small 4/8-based scale, with common values around:

`4, 8, 12, 16, 18, 24, 28, 32`

Existing screen-specific values remain valid when they are part of approved geometry. Major current horizontal insets include:

- Home profile/banner layout: approximately `18pt`;
- Materials: `18pt`;
- Question Bank list: approximately `17pt`;
- Settings root: approximately `24pt`;
- Appearance: `18pt`;
- Profile content: `18pt`.

Safe-area insets are owned by the relevant native or safe-area-aware container. Fixed controls must remain clear of the Dynamic Island, status bar, tab bar, and home indicator.

## Typography

Pythagoras is Arabic-first and RTL-first. The current app uses the platform React Native typography architecture with the existing app-level `fontScale` multiplier. No new Western brand font is part of this generation.

- Primary educational text uses `text` and comfortable line height.
- Supporting labels use `textSecondary`.
- Metadata/helper content uses `textTertiary`.
- Important long-form Question and Answer content remains high contrast.
- `AmiriQuran` is used only for semantic Quran blocks and detected Quran inline ranges.
- Critical labels should not become tiny or rely on truncation when font scaling increases.

## Motion and Haptics

Motion is restrained, native, functional, and interruptible. It explains a state change rather than decorating the screen.

Current examples include:

- native Stack push/back transitions;
- native SwiftUI Banner paging;
- the Question Card to Reader morph;
- subtle Pressable feedback;
- selection haptics for approved appearance slider points and favorite interactions;
- a light impact when opening a Question Card.

Do not add bounce, glow, or large scale transitions to ordinary selection. Respect Reduce Motion where an existing animation path supports it. Haptics should be reserved for meaningful actions rather than every tap.

## Native-First Rule

Use a system/native primitive when the interaction belongs to the operating system:

- NativeTabs;
- Expo Router native Stack and native back;
- native Stack Search Bar;
- `@expo/ui` Slider and other supported native controls;
- Switch when used by a future approved settings control;
- SF Symbols and Android Material Symbols;
- native sheets, menus, and context menus where appropriate;
- genuine `GlassView` for appropriate native material.

Custom Pythagoras UI owns Question Cards, Material Cards, Banner creative, Reader content surfaces, grouped Product sections, and study experiences. Native material is not a default background for every card.

## RTL and Physical Direction

Arabic text remains RTL, but physical layout and semantic text direction are separate concerns.

- Do not add `row-reverse` or `array.reverse()` automatically.
- Do not mirror uploaded images.
- Use explicit physical direction when a control must match a spatial interaction.
- Keep ordinals and other numeric identifiers LTR-isolated when necessary.
- Poetry hemistichs may use separate visual alignment while preserving Arabic text semantics.
- Native navigation and system gestures retain platform semantics.

## Accessibility

Accessibility is part of the visual system, not a later layer.

- Preserve Dynamic Type/system accessibility scaling alongside the app font preference.
- Give meaningful images and icon-only controls descriptive accessibility labels.
- Expose selected, pressed, and expanded states where applicable.
- Keep interactive targets at least `44pt` on iOS and appropriate Material guidance on Android.
- Keep at least comfortable spacing between adjacent targets.
- Do not communicate important state through color alone.
- Preserve Reduce Motion and Reduce Transparency behavior where supported.
- Maintain readable contrast for primary and normal supporting text in both modes.
- Hide decorative icons from the accessibility tree when equivalent visible text already communicates their meaning.

## Question Bank

Question Bank is a high-frequency reading surface. Long-session comfort takes priority over spectacle.

Current rules:

- page canvas uses `background`;
- Question Cards use `surface` with consistent approved geometry;
- ministerial badges and loading placeholders use `surfaceElevated`;
- primary Question/Answer text uses `text`;
- metadata uses secondary/tertiary tokens;
- ordinal blue is reserved for the meaningful ordinal state;
- borders remain hairline/subtle;
- no decorative gradients or strong shadows are introduced;
- native Search remains a native Stack Search Bar;
- Question Card geometry, search behavior, favorites, and Reader behavior are Product contracts.

## Question Reader

The Reader is an elevated focus surface, not a separate visual identity. It currently uses:

- one backdrop blur layer for the modal backdrop;
- a tonal Reader surface using `surface`;
- continuous rounded corners and adaptive height;
- internal scrolling for long content;
- `surfaceElevated` for provenance and loading treatments where needed;
- semantic borders and native circular controls;
- Quran typography and structured rich content without changing educational data.

Avoid nested-card explosion. Internal grouping should be introduced only when it clarifies Question, Answer, provenance, or variants.

## Materials

Materials are imagery-led and intentionally different from utility surfaces.

Preserve:

- full artwork and Admin-controlled image positioning;
- Admin `fadeIntensity`, `textVerticalPosition`, `textScale`, and `cardHeight` semantics;
- continuous image-card corners;
- the single continuous black readability gradient over the artwork;
- crisp Arabic and English overlay text;
- current `expo-image` rendering and content fit.

Do not recolor or tint Material photographs to force them into the neutral palette. Missing-image fallbacks may use semantic inset surfaces.

## Banner

The approved Banner treatment is artwork-led and remains unchanged by this document:

- `5:2` card ratio;
- approximately `18pt` horizontal inset;
- continuous approximately `30pt` corners;
- fixed outer card with artwork moving inside;
- SwiftUI `TabView` as the iOS pager;
- compact Pythagoras page indicator as the single visible indicator;
- Admin-controlled interval and preserved physical page order;
- Android/Web fallback pager retained.

The page indicator is subordinate to the creative artwork. Banner geometry, Admin transforms, autoplay, touch pause, wrapping, and native pager behavior are Product contracts.

## Glass

Glass is a native interaction/elevation material, not the default background for all Product surfaces.

Use genuine native Liquid Glass where it adds meaning, including:

- floating Home circular actions;
- compact Banner pagination;
- Reader close/favorite controls;
- other focused or transient native controls when approved.

Do not use GlassView for every Question Card, Settings row, or content container. Tonal Warm Graphite surfaces are the default. Never imitate native glass with arbitrary translucent rectangles, gradients, or nested blur layers.

## Current Screen Examples

### Home

Warm canvas, approved profile/settings actions, and the existing Banner Carousel. No new dashboard content is implied by the Design System.

### Materials List

Warm canvas with image-led Material Cards. Loading/error states use semantic surfaces without recoloring artwork.

### Material Detail

One compact strong primary action followed by one grouped secondary action surface for Question Bank, History, and Favorites.

### Settings

Native Stack navigation over a Warm Graphite canvas, with two custom grouped surfaces and native/system icons.

### Appearance

Grouped mode previews, a single future-ready default Theme option, and the native font-size Slider. Selection never changes layout.

### Question Bank

Quiet canvas, darker Question Cards, restrained metadata, native Search, and content-first density.

### Question Reader

Blurred/receded backdrop, adaptive focused surface, structured rich content, and restrained native controls.

### Favorites

The same Question Card language and semantic favorite red; no special unrelated palette.

## Evolving the Design System

- The Product Owner may change a principle or token at any time.
- Update runtime tokens first or alongside the Product change.
- Update this document in the same approved commit whenever the active system changes.
- Do not preserve outdated current rules merely for historical compatibility.
- Increment the document generation when the visual language changes materially.
- Prefer a reusable semantic token when a value clearly becomes a cross-screen role.
- Do not create tokens for every one-off numeric value.
- Keep screen-specific approved geometry documented as component behavior until it is genuinely global.

## Anti-Patterns

Avoid:

- pure black as the universal Product background;
- pure white as the universal Light canvas;
- random per-screen neutral grays;
- arbitrary decorative gradients;
- excessive glass;
- oversized shadows;
- nested cards everywhere;
- arbitrary corner radii;
- bright accent colors over large areas;
- fake iOS components when a stable native equivalent exists;
- custom controls that replace useful native behavior;
- selection states that change geometry;
- duplicate design-token sources;
- Android pretending to be iOS.

## Implementation References

- Runtime palette: `mobile/src/theme.ts`
- Appearance preferences: `mobile/src/preferences/preferences-provider.tsx`
- Home and Banner: `mobile/src/home/` and `mobile/src/components/home/`
- Settings: `mobile/src/settings/`
- Materials: `mobile/src/materials/`
- Question Bank: `mobile/src/question-bank/`
- Profile: `mobile/src/profile/`
- Native route/layout boundaries: `mobile/app/`
