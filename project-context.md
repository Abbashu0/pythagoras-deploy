# Pythagoras project context

Pythagoras is an Arabic study product with two product surfaces:

- Student: `public/pythagoras/`, served at `/`.
- Admin: `src/app/admin/`.

The content-platform master plan supersedes the earlier no-backend restriction. M1 now provides a local Next.js server foundation backed by SQLite + Drizzle under `src/server/content/`, with committed migrations in `drizzle/`. Runtime data is configured by `PYTHAGORAS_DATA_DIR`; its safe Windows fallback is `%LOCALAPPDATA%\Pythagoras\data`. Runtime databases and assets must never be committed.

Current banners, materials, navigation, tools, and uploaded images still use browser localStorage/IndexedDB. They have not been migrated and must not be deleted. Asset Library, authentication, Change Sets, review/publish, backups, and published Student content APIs are not implemented yet.

The prior Question Bank and all question data remain intentionally removed. Admin and Student show placeholders. Do not add Question data, Quiz Ready, MCQ generation, grading, distractors, timers, or attempts. The future Question Bank must use stable IDs, variants with per-variant provenance, one shared answer, rich structured blocks, and Published-only Student reads.

Do not add Firebase, Supabase, or Prisma. Supabase/Postgres is only a future adapter behind repository/storage/search boundaries. Preserve the current Student/Admin UI rather than rebuilding it.

Graphify, Understand Anything, Obsidian, Pythagoras-Brain, local AI tooling, and local MCP state are local-only developer tools and must never be committed.
