# notes-app

A small notes app that uses Jini by wiring only: a plain Node `http` server, SQLite, notes you can
create, edit, publish and list, and a contact form under each note. No Express.

## Run

```sh
pnpm install && pnpm --filter @jini-ai/core --filter @jini-ai/db --filter @jini-ai/http-kit --filter @jini-ai/cms build
cd examples/notes-app
node src/main.ts                 # http://127.0.0.1:3000, data in ./data/notes.db
node src/main.ts --db /tmp/n.db --port 4000   # or NOTES_DB / PORT
node scripts/smoke.ts            # restart proof: prints PASS or FAIL
node --test 'src/**/*.test.ts'   # adapter and app tests
pnpm typecheck
```

Node 22.18+ runs the `.ts` files directly (type stripping).

## Wiring

| Piece | From Jini | In the app |
|---|---|---|
| Routes | `Server` (`@jini-ai/core/contracts/server`, types only) | `src/node-server.ts`: Node `http` adapter, path matching, 404/405 |
| Database | `openSqliteConnection` (`@jini-ai/db/sqlite`), `sqliteKernel` (`@jini-ai/db/kernel/sqlite`) | `src/db.ts` passes `better-sqlite3` in |
| Notes | `createEntry`, `updateEntry`, `publishEntry`, `listEntries` (`@jini-ai/cms/entries`) | `src/notes-repo.ts`: a SQL entry repo (none is exported) |
| Notes table | `declareDataModule` (`@jini-ai/db/data-modules`) | declared as a plugin data module (no entries table bootstrap exists) |
| Contact form | `createFormDefinition`, `submitForm` (`@jini-ai/cms/forms`), `createFormsTables`, repos (`@jini-ai/cms/forms/sql`), `renderHtmlForm` (`@jini-ai/cms/forms/html-render`), `createRateLimiter` (`@jini-ai/http-kit/rate-limit`) | `src/ports.ts`: authorize, outbox, dispatcher; the form's client address is the socket peer |
| Pages | `escapeHtml` (`@jini-ai/core/text`) | `src/pages.ts`: hand-written templates |

Every place the app had to write something Jini could own is marked `// GAP:` in the source.

Routes: `GET /`, `POST /notes`, `GET /notes/:slug`, `POST /notes/:slug/edit`,
`POST /notes/:slug/publish`, `POST /forms/:slug`, `GET /api/notes`,
`GET /api/forms/:slug/submissions`, `GET /api/session` and the entity routes below.

The app has one local owner and no login; it is meant to run on localhost.

## Entity API (what the admin screens call)

`/api/entities/note` is the notes as one `AdminEntityPort` (`src/notes-entity.ts`, a mapping over `@jini-ai/cms/entries`;
`src/gaps/entity-routes.ts` is the generic JSON layer). `GET /api/session` answers the fixed local owner.

| Route | Answer |
|---|---|
| `GET /api/entities/note?limit=&cursor=&search=` | `{ items, nextCursor, total }`, newest first; `cursor` is the last id of the previous page |
| `GET /api/entities/note/:id` | the row, or 404 |
| `POST /api/entities/note` | 201 + the row. `{ title, body?, slug?, status? }`; the slug is made from the title when not given |
| `PATCH /api/entities/note/:id` | the row. Needs `version` (the version you read); `title`, `body`, `status` are optional. A stale `version` is 409 `CONFLICT` and nothing changes |

Row: `{ id, title, slug, body, status, version, updatedAt }`. `status` is `draft`, `published` or `unpublished`
(publish then unpublish ends in `unpublished`). `slug`, `version` and `updatedAt` are read-only (`persistedOnly`
in the descriptor): the slug cannot change after creation. There is no delete: the entry services have none.
Errors are `{ error: { code, message } }`: `VALIDATION` 400, `NOT_FOUND` 404, `CONFLICT` 409, `BAD_REQUEST` 400
(invalid JSON), `PAYLOAD_TOO_LARGE` 413 (body over 256 KB). Every route is behind the guard below.

Search reads the whole collection and filters in memory (title and body, case-insensitive): fine for a demo,
not a database bound (gap G20). The port types come from `@jini-ai/admin/core` through a `paths` entry in
`tsconfig.json` (a type-only import, erased at run time) instead of a dependency, because the lockfile cannot be
regenerated under the repo's `minimumReleaseAge` policy at this base; make it a `workspace:*` dependency and drop
the `paths` entry when it can.

## Request guard

Every route `registerNotesApp` registers runs behind a Host/Origin guard (`src/gaps/origin-guard.ts`).
A request is refused with 403 and `{ error: { code, message } }` when:

- its `Host` is not loopback (`127.0.0.1`, `localhost`, `[::1]`) on the port the server really bound
  (`HOST_REJECTED`, any method; the port is read after `listen`, never from a header),
- it carries an `Origin` that is not the app's own (`ORIGIN_REJECTED`),
- or it is a state-changing request the browser marks `Sec-Fetch-Site: cross-site` (`ORIGIN_REJECTED`).

A POST with no `Origin` from the same host (curl, scripts) is allowed. Requests that match no route
(the adapter's 404 and any `onUnmatched` hook) are not behind the guard.

## Unmatched requests

`createNodeServer({}, { onUnmatched })`: `onUnmatched({ request })` may return a `Response` for a request
whose path matches no route (return `undefined` to keep the plain 404). It is never called for a matched path,
so a wrong method still gets the 405. A hook that throws gets a 500 and the error goes to `reportError`
(default `console.error`).

## Gaps

`GAPS.json` lists every file that holds code Jini should own, with its gap id and a line budget.
`pnpm --filter @jini-example/notes-app run gaps` fails when a listed file is missing, lacks its
`// GAP: <id>` header, or has grown past its budget. The counts only go down.
