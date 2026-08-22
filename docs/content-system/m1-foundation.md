# M1 — Persistent local foundation

M1 adds the server-side persistence boundary for the Pythagoras content platform. It does not migrate existing browser data and does not change Student or Admin UI behavior.

## Runtime data directory

Set `PYTHAGORAS_DATA_DIR` to keep runtime data in a chosen directory:

```powershell
$env:PYTHAGORAS_DATA_DIR = "D:\PythagorasData"
npm run dev
```

When the variable is absent, Windows uses `%LOCALAPPDATA%\Pythagoras\data`. Other platforms use `~/.pythagoras/data`.

The initialized layout is:

```text
data/
├── db/pythagoras.sqlite
├── storage/objects/
├── exports/
├── backups/
├── temp/
└── logs/
```

Only the SQLite database is active in M1. Object storage, exports, backups, and logs are reserved directories for later milestones. Runtime data must never be committed.

## Database and migrations

- SQLite driver: `better-sqlite3`
- ORM: Drizzle
- Migration files: `drizzle/`
- Runtime journal mode: WAL
- Foreign-key enforcement: enabled
- Busy timeout: 5 seconds

Schema changes must be generated as migrations:

```powershell
npm run db:generate -- --name descriptive-name
```

Runtime startup applies committed migrations before opening repositories. Do not add ad-hoc startup `CREATE TABLE` statements.

## Boundaries

- `ContentRepository` is the canonical content persistence contract.
- `SQLiteContentRepository` is its local adapter.
- `AssetStorage` and `SearchProvider` are boundaries only in M1; their implementations belong to later milestones.
- UI code must not import SQLite or filesystem modules.

The initial `content_resources` table supports stable IDs, typed resource keys, JSON payloads, timestamps, and optimistic revisions. It is intended for simple platform resources; the relational Question Bank schema will be introduced separately and will not be reduced to this generic table.

## Concurrency behavior

Updates and deletes require `expectedRevision`. A stale revision raises `ContentConflictError`; no silent last-write-wins behavior is allowed.

M1 does not implement Change Sets, review, approval, or publication. Those workflows will build on this revision foundation.

## Status endpoint

`GET /api/system/status` verifies that the server can initialize SQLite and apply migrations. It returns migration count and journal mode but does not reveal the absolute data path or secrets.

## Verification

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```
