# Pythagoras project context

Pythagoras is an Arabic study product. The current repository contains two local-first product surfaces only:

- Student application: `public/pythagoras/`, served at `/`.
- Admin application: `src/app/admin/`, with local browser storage for supported content controls.

This phase has no backend, database, API routes, user management, premium system, or analytics service. The prior Question Bank implementation and all question data were intentionally removed; the product uses clean placeholders until a separate dataset and specification are supplied.

Do not add Firebase, Supabase, Prisma, a backend, or question data unless explicitly requested. Preserve the existing student and admin UI rather than rebuilding it from scratch. A future server/data architecture is not implemented.

Graphify, Understand Anything, Obsidian, Pythagoras-Brain, local AI tooling, and local MCP state are future local-only developer tools and must never be committed.
