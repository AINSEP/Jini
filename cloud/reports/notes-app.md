# R1: notes app, a small second app on Jini

Branch `cloud/notes-app`, cut from `origin/cloud/extract` at `35c4961af`. Started 2026-11-07 21:32 UTC and finished at about 21:52 UTC, well inside the 2-hour cap. Three steps ran one after another, each in its own subagent. No follow-up step was needed.

**Result:** `examples/notes-app` runs on persistent SQLite with a plain Node `http` server. It has no Express, imports only public `@jini-ai/{core,db,cms}` exports, contains no copied Jini code and no hand-written DDL, and its notes and form submissions survive a restart. That only works because the app writes several pieces itself, listed in the gap table below. The biggest one is that cms entries have no durable storage.

Setup baseline on the unmodified tree: `pnpm install --frozen-lockfile` exited 0 and `pnpm -r build` exited 0.

## N1: `Server` contract in `@jini-ai/core`. Done.

- Commit: `2ebbc7bc` feat(core): Server route contract on web Request/Response
- Files changed:
  - `packages/core/src/server.ts` (new)
  - the barrel export in `src/index.ts`
  - a `./server` subpath in `package.json`
  - `src/__tests__/server.test.ts` (6 tests)
  - `src/args-convention.typecheck.ts`, which gained compile-time checks that wrong argument shapes are rejected
- API:
  - `ServerMethod` is `'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`.
  - `ServerHandler` is `({ request, params }, optional?) => Response | Promise<Response>`.
  - `interface Server { route({ method, path, handler }, optional?): void }`, with an `@agent-note` saying it is fulfilled by "whichever server adapter you prefer, including Express".
  - `matchServerPath({ pattern, pathname })` is a pure path matcher that every adapter shares. It handles literal and `:name` segments, with no wildcards.
- Tests:
  - `npx tsc -p packages/core --noEmit`: exit 0
  - `npm --prefix packages/core exec -- vitest run src/__tests__/server.test.ts --maxWorkers=2 --minWorkers=1`: 6/6. The filter also matched `cookie-consent`'s `server.test.ts`, which passed 19/19.
  - core's `index.test.ts`, `settings-subpath-isolation.contract.test.ts` and `source-neutrality.test.ts`: 9/9
  - `npx tsx scripts/check-subpath-isolation.ts`: exit 0
- Decisions:
  - Handlers take `({ request, params })` rather than the usual fetch shape `(request, ctx)`, because of the (requiredObj, optionalObj) rule.
  - There is a single `route()` method rather than `get`/`post`.
  - Methods are uppercase. http-kit's `HttpMethod` is lowercase.
  - Nothing is reused from http-kit, because core cannot import it. The overlap is `HttpMethod` and `RouteInputContext.params`.
  - core's lib setting is ES2023, so the `Request`/`Response` types come from `@types/node`. Consumers of the `.d.ts` need DOM lib or `@types/node`.

### What streaming, uploads and raw bodies would need (not built)

- **Streaming / SSE:** the contract already allows it, since a handler can return a `Response` with a `ReadableStream` body.
  - The adapter must pipe the body without buffering and flush headers early.
  - On client disconnect it must cancel the reader and abort `request.signal`. The notes-app adapter already does the abort.
  - http-kit's `sse.ts`/`raw-sse.ts` should become a pure helper that builds a `ReadableStream`.
- **Uploads:** use `request.formData()` or stream `request.body`.
  - The adapter must build a streaming `Request` (`duplex: 'half'`).
  - A body size limit is missing. It needs an adapter option plus a per-route optional `{ bodyLimitBytes }` on `route(required, optional)`.
- **Raw body:** `request.arrayBuffer()` and `request.text()` already cover it. The adapter must never pre-parse the body.
- **Route metadata http-kit has that this contract lacks:**
  - same-origin requirement
  - auth and workspace ports, and the error envelope
  - success status
  - internal-error sink
  - rate limiting
  - middleware order

  These are best written as wrappers that take a handler and return a handler. If a declarative form is ever needed, they can move into `route`'s optional object.

## N2: forms table bootstrap in `@jini-ai/cms`. Done.

- Commit: `7a079cd2` feat(cms): export forms table bootstrap for host-passed kernel
- Export: `@jini-ai/cms/forms/sql` → `createFormsTables({ kernel, tables: { definitions, submissions } }, _optional?)`.
  - It is idempotent (`IF NOT EXISTS`), works on SQLite and Postgres, and takes the table names from the host.
  - Identifiers are quoted through kysely.
  - Index and foreign-key names are built from the table names. With the old default names they come out exactly as before.
  - The test fixture `__tests__/support/forms-tables.fixture.ts` is now a thin wrapper around this export and no longer holds its own DDL.
- It does not use the `db/migrate` runner. A `MigrationStep` needs an id and a pinned checksum, and those belong to the host. A host with a migration ledger calls `createFormsTables` from its own step. cms depends on `@jini-ai/db` only for the low-level kernel contract.
- Tovu is unaffected: nothing was wired into it, and no migration chain, ledger, column name or saved format changed.
- Tests: run from `packages/cms`:
  - `npm exec -- vitest run src/forms/__tests__/{create-tables,repo.dialects,repo.contract,submission-ip-retention.dialects}.test.ts src/__tests__/{args-convention,subpath-isolation.contract,integration-package.contract}.test.ts --maxWorkers=2 --minWorkers=1`: 7 files, 106/106. The existing counts are unchanged (dialects 26, contract 58, ip-retention 6), and `create-tables.test.ts` adds 3 tests:
    - a SQLite file: create, create again, save and read, close and reopen, read again
    - the SQLite foreign key blocks deleting a form that has entries
    - PGlite: idempotent, and the repos save and read
  - `npx tsc -p tsconfig.json --noEmit`: exit 0

## N3: `examples/notes-app`. Done.

- Commits:
  - `646ba402` wip(examples): notes-app wired on core Server, cms entries/forms, db sqlite (includes a `pnpm-lock.yaml` change for the new workspace member)
  - `c93e7324` feat(examples): notes-app restart smoke script and README
- No Jini package was changed in this step.
- What the app does:
  - create, edit, publish and list notes
  - a list page, and a detail page carrying a contact form rendered by `renderHtmlForm`
  - a POST runs `submitForm` and stores the submission in N2's tables
  - submissions are listed through `listByDefinition`
- Checks:
  - `cd examples/notes-app && npx tsc -p tsconfig.json --noEmit`: exit 0
  - `node scripts/smoke.ts`: 11 checks ok, then `PASS`. The coordinator re-ran it on its own and got the same result.
  - The smoke script covers create, edit, publish, form submit, 404 and 405. It then restarts on the same database and confirms the note's edit, its published status, the stored submission and the list page.
- `npx tsx scripts/guard.ts`: 2 violations, neither caused by this work. They are in `plugin-catalog/scripts/generate.ts` (R2) and `chat/.../ChatPane.tsx` (R10), files this branch did not touch.
- Tarball run:
  - `pnpm pack` was run for `@jini-ai/core` 0.6.23, `@jini-ai/db` 0.6.19 and `@jini-ai/cms` 0.6.22.
  - A throwaway consumer was built in the scratch directory with `file:` dependencies and npm `overrides`.
  - No `workspace:` protocol leaked into the packed packages, and none of the app's imports were missing from the packed `files`.
  - **The first run failed** with `ERR_MODULE_NOT_FOUND: parse5` (see Bugs). After `npm install parse5@^7.3.0` the smoke test passed and the consumer type-checked (tsc 5.9.3, exit 0).
  - The consumer was deleted afterwards. Nothing was published.
- Optional plugin with a saved setting: **skipped**.

## The app's own wiring, counted

The source files total 532 lines (`wc -l`). On top of that are `scripts/smoke.ts` (79 lines) and `README.md` (36 lines). The source has 12 `// GAP:` markers.

| file | lines | what it is |
|---|---|---|
| `src/node-server.ts` | 111 | Node `http` adapter for core `Server`: IncomingMessage → Request, streamed Response, abort on disconnect, 404/405 with Allow, error on duplicate route |
| `src/app.ts` | 139 | routes, plus seeding the contact form definition at boot |
| `src/db.ts` | 74 | opens SQLite through `@jini-ai/db`, creates the forms tables, declares the notes data module |
| `src/ports.ts` | 69 | hand-written ports: authorize, outbox, dispatcher, rate limiter, form HTML hooks |
| `src/notes-repo.ts` | 58 | in-app SQL entry repo (`EntryRepoPort` + `EntryListPort`) |
| `src/pages.ts` | 54 | HTML templates and request/response helpers |
| `src/main.ts` | 27 | entry point (`--db`, `--port`) |

Public imports used:
- `@jini-ai/core/server`, `/primitives`, `/text`
- `@jini-ai/db/sqlite`, `/kernel/sqlite`, `/data-modules`
- `@jini-ai/cms/entries`, `/content-types`, `/core`, `/core/commands`, `/forms`, `/forms/html-render`, `/forms/sql`
- `better-sqlite3`

These came from Jini with no extra code:
- `createEntry`, `updateEntry`, `publishEntry`, `listEntries`
- `InMemoryContentTypeRepo`, `toEntryOutbox`, `InMemoryChangeSetRepo`, `executeCommand`
- the system clock and UUID ids
- `createFormDefinition`, `submitForm`, `listByDefinition`, `renderHtmlForm`, `createFormsTables`
- `openSqliteConnection`, `sqliteKernel`, `matchServerPath`, `escapeHtml`

## Gaps, ordered for extraction work

| # | what the app needed | what it did instead | owner | rough size |
|---|---|---|---|---|
| 1 | Durable entries storage | Wrote `EntryRepoPort` + `EntryListPort` in the app, storing each record as JSON in one table. Only `InMemoryEntryRepo` exists. | cms/entries `sql` subpath, like forms/sql | 58 in the app; ~150 done properly |
| 2 | Entries table bootstrap | Used `declareDataModule` (`@jini-ai/db/data-modules`), pretending to be a Tier-2 plugin `notes_app`, to get a `p_notes_app__entries` table. The DDL is declared, not hand-written, but this is a misuse of the plugin data-module system for host content. | cms/entries `createEntriesTables`, the same shape as N2 | ~60 |
| 3 | Entry revisions | None. `appendRevision` throws them away, so there is no history. | cms/entries sql | small |
| 4 | Node `http` adapter for `Server` | Wrote it in the app. | core (a node-only subpath) or a tiny adapter | 111 |
| 5 | Request/response helpers: html, json, 303 redirect, reading a form body, client IP | Wrote them in the app. Client IP comes from a forwarded header, falling back to loopback. | core/server | ~25 |
| 6 | Server-side page rendering for entries | Hand-wrote templates with `escapeHtml`. cms `presentation` only stores a theme id, and http-kit's HTML helpers are tied to Express. | cms (presentation) | ~50 |
| 7 | Neutral in-memory / no-op form ports: outbox, dispatcher, rate limiter | Wrote them in the app. http-kit's rate limiter is tied to Express. | cms/forms | ~30 |
| 8 | Default `FormHtmlHooks` | Defined a constant in the app. | cms/forms/html-render | 1 |
| 9 | Simple authorize (allow-all or single owner) | Wrote it in the app. | cms/core | 3 |
| 10 | Durable outbox and change sets | Kept them in memory, so they are lost on restart. | cms/core sql | medium |
| 11 | Content types persisted | `InMemoryContentTypeRepo`, re-seeded at every boot. | cms/content-types sql | medium |
| 12 | A list-submissions service | Called the repo's `listByDefinition` directly. | cms/forms | small |
| 13 | Ports needed just to create a form | `createFormDefinition` needs 8+ ports (executeCommand, changeSets, permission, reservedSlugs, authorize, …). That is the heaviest part of the wiring. | cms/forms: a documented minimal-deps recipe or a default set | small to medium |
| 14 | Route metadata: body limits, same-origin, error envelope | Not handled. See N1. | core/server optional object, or handler wrappers | medium |

## Bugs

- **Packaging:** `@jini-ai/cms/forms/sql` loads `parse5` at import time, through `forms/sql/repo.rows.ts:3` → `forms/html/html-authoring.ts`. But cms declares `parse5` only as an optional peer, so a tarball consumer fails with `ERR_MODULE_NOT_FOUND: parse5`. Inside the workspace this is hidden, because parse5 is one of cms's dev dependencies.
- **Possible, not confirmed:** `packages/cms/src/forms/sql/repo.rows.ts:77` reads a null `source_ip` back as `""`, while `FormSubmissionRecord.sourceIp` is typed `string | null` (`types.ts:79`).
- **Typing note:** core's new `server.ts` relies on `@types/node` for `Request`/`Response`, because core's lib setting has no DOM.

## Token table

Each figure is that agent's final context size. A subagent's figure comes from its completion notice; the coordinator's is an estimate.

| agent | tokens |
|---|---|
| N1 (core Server) | 101,264 |
| N2 (forms tables) | 117,653 |
| N3 (notes app) | 156,209 |
| coordinator (estimate) | ~55,000 |
| **total** | **~430,000** of the 600k cap |
