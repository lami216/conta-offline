# Conta Offline architecture

## Repository audit (before conversion)

The original application was a Next.js server deployment. API route handlers contained MongoDB collection queries and multi-document transactions; bootstrap and reports used MongoDB aggregation; authentication required an environment-provided owner password hash and signed cookie; production startup expected Node, Atlas, PM2, Nginx, DNS, and HTTPS. The DataAcc importer already used `sql.js`, but wrote its normalized results to MongoDB. The React/RTL UI called same-origin `/api/*` routes and can therefore remain unchanged.

## Offline architecture (after conversion)

```text
Electron main process (single instance)
  ├─ creates user-data/data, backups, imports, logs and temp
  ├─ starts packaged Next standalone on 127.0.0.1 and a free port
  └─ hardened BrowserWindow → local /api/*
       └─ services → better-sqlite3 → user-data/data/conta.db
```

`lib/storage/schema.ts` owns the normalized schema and constraints. `schema_migrations` separates database schema version from application version. `lib/services` is the business/storage boundary; multi-write commands execute inside a synchronous SQLite transaction. SQLite enables foreign keys, WAL, a five-second busy timeout, and `synchronous=FULL`.

The sole current principal is `local-owner`; `requireCapability` remains as the future RBAC seam. There is no password or session secret. Mutation routes still reject requests not originating from the exact loopback origin and port. Electron disables renderer Node integration, enables context isolation and sandboxing, and blocks non-local navigation.

## Data and lifecycle

Production data is under `%LOCALAPPDATA%\Conta Offline`; development defaults to the OS temporary directory and cannot touch production data. Application updates replace packaged resources only. NSIS does not delete app data during normal uninstall.

Logical backups use `conta-backup` schema v2. Restore also accepts schema-v1 MongoDB Extended JSON backups and maps their stable IDs into relational tables. A physical safety copy is created before restore and DataAcc import. Online migration is deliberately file-based: export a normal backup in online Conta, transfer it, then restore it in Conta Offline.

## Packaging

Electron Builder packages `.next/standalone`, `.next/static`, `public`, the native SQLite module (unpacked from ASAR), and the DataAcc `sql-wasm.wasm`. The customer installer contains Electron/Node and never downloads runtime components.
