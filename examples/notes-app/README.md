# notes-app

A small notes app that uses Jini by wiring only: a plain Node `http` server, SQLite, notes you can
create, edit, publish and list, and a contact form under each note. No Express.

## Run

```sh
pnpm install && pnpm --filter @jini-ai/core --filter @jini-ai/db --filter @jini-ai/cms build
cd examples/notes-app
node src/main.ts                 # http://127.0.0.1:3000, data in ./data/notes.db
node src/main.ts --db /tmp/n.db --port 4000   # or NOTES_DB / PORT
node scripts/smoke.ts            # restart proof: prints PASS or FAIL
pnpm typecheck
```

Node 22.18+ runs the `.ts` files directly (type stripping).

## Wiring

| Piece | From Jini | In the app |
|---|---|---|
| Routes | `Server`, `matchServerPath` (`@jini-ai/core/server`) | `src/node-server.ts`: Node `http` adapter, 404/405 |
| Database | `openSqliteConnection` (`@jini-ai/db/sqlite`), `sqliteKernel` (`@jini-ai/db/kernel/sqlite`) | `src/db.ts` passes `better-sqlite3` in |
| Notes | `createEntry`, `updateEntry`, `publishEntry`, `listEntries` (`@jini-ai/cms/entries`) | `src/notes-repo.ts`: a SQL entry repo (none is exported) |
| Notes table | `declareDataModule` (`@jini-ai/db/data-modules`) | declared as a plugin data module (no entries table bootstrap exists) |
| Contact form | `createFormDefinition`, `submitForm` (`@jini-ai/cms/forms`), `createFormsTables`, repos (`@jini-ai/cms/forms/sql`), `renderHtmlForm` (`@jini-ai/cms/forms/html-render`) | `src/ports.ts`: authorize, outbox, dispatcher, rate limiter |
| Pages | `escapeHtml` (`@jini-ai/core/text`) | `src/pages.ts`: hand-written templates |

Every place the app had to write something Jini could own is marked `// GAP:` in the source.

Routes: `GET /`, `POST /notes`, `GET /notes/:slug`, `POST /notes/:slug/edit`,
`POST /notes/:slug/publish`, `POST /forms/:slug`, `GET /api/notes`,
`GET /api/forms/:slug/submissions`.

The app has one local owner and no login; it is meant to run on localhost.
