import { defineJsonRoute, ok, routeReply, type JsonRouteAuthorize, type JsonRouteSpec, type RouteReply } from '@jini-ai/core/contracts/server';

/**
 * @file Admin Deployment panel → Dockerfile tab backend.
 *
 * `GET`/`PUT /api/admin/v1/workspaces/:workspaceId/system/dockerfile` — reads and writes
 * the repo-root `Dockerfile`'s contents.
 *
 * 2026-08-15: this tab is now editable, not read-only — both a human in the admin and the
 * `deployment_get_dockerfile`/`deployment_set_dockerfile` agent tools can read and write the same
 * file. The actual `fs` read/write is the host's (injected as `read`/`writeWithIfMatch`) so both
 * callers share one path-resolution rule instead of each hardcoding `join(process.cwd(), "Dockerfile")`
 * independently — neither function accepts a path argument at all, so there is no path input to
 * sanitize in the first place. `PUT` is `system.write`-gated, distinct from `GET`'s `system.read` —
 * writing a build file is not a read, mirroring `export-site.ts`'s `system.export` vs `system.read`
 * split for the identical reason (a mutation needs its own permission string, never folded into a
 * `*.read` grant).
 *
 * Writing the Dockerfile does not build, validate, or deploy anything — this route only replaces
 * the file's bytes on disk. Nothing here shells out to `docker build`, and the response never
 * implies otherwise.
 *
 * ## 2026-08-15 — `If-Match`/`ETag` optimistic concurrency (Terra audit finding C5)
 *
 * `GET` sets a real `ETag` response header (the snapshot's `etag`) on every response, including the
 * "does not exist" case. `PUT` REQUIRES a matching `If-Match` request header — see the host's
 * `writeWithIfMatch` for the full decision record (strict, not permissive) and the residual race
 * window it honestly does not close. A `PUT` with no `If-Match` at all is `400`, not treated as an
 * unconditional write; a `PUT` whose `If-Match` no longer names the file's current contents is `412
 * Precondition Failed`, with the CURRENT `{exists, contents}` in the body so the caller can diff and
 * reconcile instead of retrying blind. The JSON response body deliberately stays `{exists, contents}`
 * on every status — the etag travels ONLY via the `ETag`/`If-Match` headers, not duplicated into the
 * body, so there is exactly one wire representation of "what etag is this" rather than two that could drift.
 *
 * Gate order (PUT): the host mount's workspace refusal → `system.write` → the `If-Match` header → the
 * body. The spec's `parse` is total and only carries the header and body through, because a hand-written
 * route authorized before it answered either 400, and a parser runs ahead of the handler's authorizer.
 */

/** The file's state as the host reads it. `etag` is the content-derived validator, never put in a body. */
export interface DockerfileSourceSnapshot {
  exists: boolean;
  /** `null` when `exists` is false — never an empty string standing in for "missing". */
  contents: string | null;
  etag: string;
}

/** The host's conditional write: written, or refused with what is actually on disk now. */
export type DockerfileWriteResult = { ok: true; snapshot: DockerfileSourceSnapshot } | { ok: false; current: DockerfileSourceSnapshot };

/** The host's file access, injected: the spec holds no path and no `fs`. */
export interface DockerfileSourceRouteDeps {
  read: (required: Record<string, never>) => DockerfileSourceSnapshot;
  writeWithIfMatch: (required: { contents: string; ifMatch: string }) => DockerfileWriteResult;
}

/** The wire body both `GET` and a successful `PUT` return. */
export interface DockerfileSourceBody { exists: boolean; contents: string | null }

/** What `PUT` carries to its handler: the `If-Match` header and the raw body, both unchecked until authorization. */
export interface DockerfileWriteInput { ifMatch: string | undefined; body: unknown }

type DockerfileReply = RouteReply<unknown>;
type DockerfileReadSpec = JsonRouteSpec<Record<string, never>, DockerfileReply, DockerfileSourceRouteDeps>;
type DockerfileWriteSpec = JsonRouteSpec<DockerfileWriteInput, DockerfileReply, DockerfileSourceRouteDeps> & { readHeaders: readonly string[] };

const DOCKERFILE_PATH = '/api/admin/v1/workspaces/:workspaceId/system/dockerfile';
const ENTITY_TYPE = 'dockerfile-source';

const MISSING_IF_MATCH_ERROR =
  "the 'If-Match' header is required on PUT — GET this same URL first (its response carries an 'ETag' header with the file's current value), then send that value back as 'If-Match' to prove your write is based on the current contents, not a stale copy. This is deliberate (Terra audit finding C5, 2026-08-15): an unconditional write here would let a human editing this tab and the AI assistant's deployment_set_dockerfile tool silently overwrite each other with no warning to either.";
const CONFLICT_ERROR =
  "the Dockerfile changed on the server since your 'If-Match' value was read — someone else (or the AI assistant) saved a different version in between. The response body's 'current' field is what's actually on disk right now; reconcile your intended change against it and retry with the 'ETag' header on THIS response.";

/** The wire body both `GET` and a successful `PUT` return — deliberately just `{exists, contents}`,
 *  never the snapshot's `etag` field; see this file's header for why the etag travels only
 *  via the `ETag` header. @complexity O(1). */
function toResponseBody({ snapshot }: { snapshot: DockerfileSourceSnapshot }, _optional: Record<string, never> = {}): DockerfileSourceBody {
  return { exists: snapshot.exists, contents: snapshot.contents };
}

/** The handler's own authorizer; a spec mounted without one is a wiring bug and fails closed. */
function requireAuthorize({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): JsonRouteAuthorize {
  if (!authorize) throw new Error('dockerfile-source route has no authorizer');
  return authorize;
}

/** Validates the write request's JSON body. Never throws — every malformed shape maps to a
 *  `{ error }` result the route turns into a `400`, mirroring `export-site.ts`'s
 *  `parseTriggerRequestBody`. `contents` is the ONLY field this route reads from the BODY — there is
 *  no path field to validate because the host's write accepts none, and the write's other required
 *  input, `If-Match`, is a HEADER (checked separately, before this parser ever runs) rather than a
 *  body field. @complexity O(1). */
function parseWriteRequestBody({ body }: { body: unknown }, _optional: Record<string, never> = {}): { ok: true; contents: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.contents !== 'string') {
    return { ok: false, error: "'contents' (string) is required" };
  }
  return { ok: true, contents: raw.contents };
}

/** `GET .../system/dockerfile`: the file's `{exists, contents}`, its etag in the `ETag` header.
 * @complexity O(1) plus the injected read. */
export const dockerfileReadRoute: DockerfileReadSpec = defineJsonRoute<Record<string, never>, DockerfileReply, DockerfileSourceRouteDeps>({
  method: 'get',
  path: DOCKERFILE_PATH,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorize({ authorize })({ permission: 'system.read', entityType: ENTITY_TYPE });
    const snapshot = deps.read({});
    return ok({ value: routeReply({ status: 200, body: toResponseBody({ snapshot }), headers: { ETag: snapshot.etag } }) });
  },
});

/** The write's answer once authorized: 400 without `If-Match` (checked BEFORE the body — a precondition
 *  on the REQUEST, distinct from whether the BODY it guards is well-formed, so a missing-header failure
 *  is never masked by a body-shape failure), 400 for a bad body, 412 for a stale `If-Match`, else 200.
 * @complexity O(1) plus the injected write. */
function writeReply({ input, deps }: { input: DockerfileWriteInput; deps: DockerfileSourceRouteDeps }, _optional: Record<string, never> = {}): DockerfileReply {
  if (!input.ifMatch) return routeReply({ status: 400, body: { error: MISSING_IF_MATCH_ERROR } });
  const parsedBody = parseWriteRequestBody({ body: input.body });
  if (!parsedBody.ok) return routeReply({ status: 400, body: { error: parsedBody.error } });
  const result = deps.writeWithIfMatch({ contents: parsedBody.contents, ifMatch: input.ifMatch });
  if (!result.ok) {
    return routeReply({
      status: 412,
      headers: { ETag: result.current.etag },
      body: { error: CONFLICT_ERROR, code: 'DOCKERFILE_CONFLICT', current: toResponseBody({ snapshot: result.current }) },
    });
  }
  return routeReply({ status: 200, body: toResponseBody({ snapshot: result.snapshot }), headers: { ETag: result.snapshot.etag } });
}

const writeSpec = defineJsonRoute<DockerfileWriteInput, DockerfileReply, DockerfileSourceRouteDeps>({
  method: 'put',
  path: DOCKERFILE_PATH,
  parse: (raw) => ok({ value: { ifMatch: raw.headers?.['if-match'], body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await requireAuthorize({ authorize })({ permission: 'system.write', entityType: ENTITY_TYPE });
    return ok({ value: writeReply({ input, deps }) });
  },
});

/** `PUT .../system/dockerfile`, opted into the one request header it reads (`If-Match`).
 * @complexity O(1) plus the injected write. */
export const dockerfileWriteRoute: DockerfileWriteSpec = { ...writeSpec, readHeaders: ['if-match'] };
