# Pythagoras project context

Pythagoras is an Arabic study product with two product surfaces:

- Student: `public/pythagoras/`, served at `/`.
- Admin: `src/app/admin/`.

The content-platform master plan supersedes the earlier no-backend restriction. M1 provides a local Next.js server foundation backed by SQLite + Drizzle under `src/server/content/`, with committed migrations in `drizzle/`. Runtime data is configured by `PYTHAGORAS_DATA_DIR`; its safe Windows fallback is `%LOCALAPPDATA%\Pythagoras\data`. Runtime databases and assets must never be committed.

M2 adds durable local Admin identity under `src/server/admin-auth/`: first-run OWNER setup, Argon2id password hashes, opaque server-side sessions, OWNER/ADMIN authorization helpers, protected Admin routes, and safe actor attribution. Admin authentication never uses browser storage or JavaScript-readable tokens. The setup and login pages are `/admin/setup` and `/admin/login`; all other `/admin` routes require an active server session.

M3 implements local `AssetStorage` and the Asset domain under `src/server/assets/`. Asset metadata is SQLite-backed; immutable binary objects live in content-addressed SHA-256 paths under `<PYTHAGORAS_DATA_DIR>/storage/objects/`. Admin Asset APIs are authenticated and derive creator attribution from the server session.

M4 adds the operational Admin Asset Library at `/admin/library`: authenticated multi-file uploads, server-side search/filter/sort/pagination, inventory statistics, grid/list browsing, safe previews/downloads, creator details, and on-demand integrity checks. The library never exposes filesystem paths or storage keys. Legacy browser images remain untouched and are not yet connected to this library.

M5 adds generic Change Sets under `src/server/change-management/` and the Admin review workspace at `/admin/review`. Mutations are captured as immutable before/proposed snapshots through closed resource adapters, with optimistic revisions, conflict detection, an append-only event timeline, OWNER-only approval, and atomic publication revisions. Approval never mutates canonical data; only OWNER publication does. The first pilot adapter is `asset.metadata` and permits only Asset `displayName` proposals. Asset bytes remain immutable.

Current banners, materials, navigation, tools, and their existing uploaded images still use browser localStorage/IndexedDB. Legacy images have not been migrated, must not be deleted, and the existing product UI still reads them from browser storage. Integration and legacy migration remain later work. M6 should establish a safe legacy browser migration foundation without silently changing current product behavior. Team-management UI, backups, Question Bank, and published Student content APIs are not implemented yet.

The prior Question Bank and all question data remain intentionally removed. Admin and Student show placeholders. Do not add Question data, Quiz Ready, MCQ generation, grading, distractors, timers, or attempts. The future Question Bank must use stable IDs, variants with per-variant provenance, one shared answer, rich structured blocks, and Published-only Student reads.

Do not add Firebase, Supabase, or Prisma. Supabase/Postgres is only a future adapter behind repository/storage/search boundaries. Preserve the current Student/Admin UI rather than rebuilding it. New Admin server mutations must derive actor identity from the validated session and apply the shared same-origin mutation protection; never trust an actor ID or role sent by the browser.

Graphify, Understand Anything, Obsidian, Pythagoras-Brain, local AI tooling, and local MCP state are local-only developer tools and must never be committed.
