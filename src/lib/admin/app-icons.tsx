"use client";

/**
 * AppIcon — React renderer for the student app's icon set.
 *
 * The student app defines a single `icon(name)` function in
 * `public/pythagoras/src/scripts/icons.js` that returns an SVG string
 * with a `<path>` body. This module mirrors those path definitions as
 * a React component so the admin UI can render the SAME icons the
 * student app uses (essential for the IconPicker preview + live preview
 * bar — what you see in admin is what students see).
 *
 * Usage:
 *   <AppIcon name="home" className="h-5 w-5" />
 *
 * Unknown names fall back to `spark-grid` (same fallback the student
 * app uses) so a typo never produces a blank icon.
 *
 * Keep this list in sync with `public/pythagoras/src/scripts/icons.js`
 * whenever a new icon is added to the student app.
 */
import * as React from "react";

const ICON_PATHS: Record<string, string> = {
  home: `<path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V20h11V9.5"/><path d="M9.5 20v-5.5h5V20"/>`,
  calendar: `<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M8 3.5v4"/><path d="M16 3.5v4"/><path d="M4 9.5h16"/>`,
  "spark-grid": `<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><path d="M16.25 13.5v2"/><path d="M16.25 19.5v.01"/><path d="M14.25 17.5h4"/>`,
  notes: `<path d="M7 4h8l4 4v12H7z"/><path d="M15 4v4h4"/><path d="M10 12h5"/><path d="M10 16h5"/>`,
  tasks: `<path d="M9 7h10"/><path d="M9 12h10"/><path d="M9 17h10"/><path d="m4.5 7 1.5 1.5L8.5 6"/><path d="m4.5 12 1.5 1.5L8.5 11"/><path d="m4.5 17 1.5 1.5L8.5 16"/>`,
  settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  tests: `<rect x="5" y="4.5" width="14" height="17" rx="3"/><path d="M9 9.5h6"/><path d="M9 13.5h3"/><path d="m9.5 17 1.8 1.8L15.5 14.5"/>`,
  biology: `<path d="M12 4c-4 0-7 3.7-7 7.8S8 20 12 20s7-3.6 7-8.2S16 4 12 4Z"/><path d="M12 4v16"/><path d="M8.5 8.5c1 .8 2.2 1.2 3.5 1.2"/><path d="M15.5 14c-1-.8-2.2-1.2-3.5-1.2"/>`,
  chemistry: `<path d="M9 4v5.5l-4 7a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 16.5l-4-7V4"/><path d="M8 9.5h8"/><path d="M9 4h6"/>`,
  physics: `<circle cx="12" cy="12" r="1.4"/><path d="M12 5c3.6 0 6.5 3.1 6.5 7s-2.9 7-6.5 7-6.5-3.1-6.5-7 2.9-7 6.5-7Z"/><path d="M7.5 7.5c3 0 6.9 2 9 4.5"/><path d="M7.5 16.5c3-2.5 6-3.8 9-4.5"/>`,
  math: `<path d="M7 7h10"/><path d="M7 17h10"/><path d="M9.5 4.5v15"/><path d="M14.5 9.5h4"/><path d="M14.5 14.5h4"/><path d="M4.5 10.5h4"/><path d="M4.5 14.5h4"/>`,
  arabic: `<path d="M6 5.5h10a2 2 0 0 1 2 2v11H8a2 2 0 0 0-2 2Z"/><path d="M6 5.5v15"/><path d="M10 10h5"/><path d="M10 14h4"/>`,
  english: `<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.5 2.2 4 5 4 8s-1.5 5.8-4 8"/><path d="M12 4c-2.5 2.2-4 5-4 8s1.5 5.8 4 8"/>`,
  islamic: `<path d="M12 4.5c.8 1.9 2.5 3.2 4.7 3.6-1.3 1.2-2 2.7-2 4.4 0 1.7.7 3.2 2 4.4-2.2.4-3.9 1.7-4.7 3.6-.8-1.9-2.5-3.2-4.7-3.6 1.3-1.2 2-2.7 2-4.4 0-1.7-.7-3.2-2-4.4 2.2-.4 3.9-1.7 4.7-3.6Z"/><path d="M12 9.5v6"/><path d="M9.5 12.5h5"/>`,
  french: `<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/><path d="M8 12h8"/><path d="M12 4c2.5 2.2 4 5 4 8s-1.5 5.8-4 8c-2.5-2.2-4-5-4-8s1.5-5.8 4-8z"/>`,
  repeat: `<path d="M17 8h3V5"/><path d="M20 8a7 7 0 0 0-12-3"/><path d="M7 16H4v3"/><path d="M4 16a7 7 0 0 0 12 3"/>`,
  timer: `<circle cx="12" cy="13" r="7"/><path d="M12 13 15 10"/><path d="M9 3.5h6"/>`,
  notebook: `<path d="M7 4.5h10a2 2 0 0 1 2 2v13H7z"/><path d="M7 4.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1"/><path d="M10 9h6"/><path d="M10 13h6"/>`,
  brain: `<path d="M10 6.5a3 3 0 0 0-5 2.3A3.4 3.4 0 0 0 7 15v1"/><path d="M14 6.5a3 3 0 0 1 5 2.3A3.4 3.4 0 0 1 17 15v1"/><path d="M12 6v12"/><path d="M9.5 10.5h5"/><path d="M9 19h6"/>`,
  lectures: `<path d="M5 6.5 12 4l7 2.5v11L12 20l-7-2.5z"/><path d="m10 10 5 3-5 3z"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  search: `<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>`,
  refresh: `<path d="M20 11a8 8 0 1 0 2 5.3"/><path d="M20 4v7h-7"/>`,
  chevron: `<path d="m6.5 9.5 5.5 5 5.5-5"/>`,
  list: `<path d="M9 7h10"/><path d="M9 12h10"/><path d="M9 17h10"/><circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/>`,
  grid: `<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 3v1M12 20v1M4.22 4.22l.7.7M19.08 19.08l.7.7M3 12h1M20 12h1M4.22 19.78l.7-.7M19.08 4.92l.7-.7"/>`,
  book: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/><path d="M20 15v3a2 2 0 0 1-2 2H6.5"/>`,
  toolbox: `<rect x="3" y="7.5" width="18" height="13" rx="2"/><path d="M8 7.5V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2.5"/><path d="M3 12h18"/><path d="M12 12v4"/>`,
  play: `<path d="M7 4v16l13-8z"/>`,
};

/**
 * The canonical list of icon names exposed by the student app's
 * `icon(name)` function. Used by the IconPicker to render the grid.
 * Order is curated — most common icons first, then subject glyphs.
 */
export const APP_ICON_NAMES: string[] = [
  "home",
  "book",
  "toolbox",
  "play",
  "settings",
  "tests",
  "biology",
  "math",
  "chemistry",
  "physics",
  "arabic",
  "english",
  "islamic",
  "french",
  "repeat",
  "timer",
  "notebook",
  "brain",
  "lectures",
  "calendar",
  "notes",
  "tasks",
  "search",
  "refresh",
  "chevron",
  "list",
  "grid",
  "sun",
  "check",
  "spark-grid",
];

export interface AppIconProps extends React.SVGProps<SVGSVGElement> {
  name: string;
}

export function AppIcon({ name, ...rest }: AppIconProps) {
  const body = ICON_PATHS[name] ?? ICON_PATHS["spark-grid"];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
      {...rest}
    />
  );
}
