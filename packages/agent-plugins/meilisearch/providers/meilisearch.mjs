// @ts-check

/**
 * @file Meilisearch search provider for the `meilisearch` Agent Plugin.
 *
 * Implements the generic site-search provider contract (`@jini-ai/search`'s `SearchProvider`) on a
 * Meilisearch v1.x server. The host loads this file through its search-provider registry and hands it a
 * per-call context: the index name, the saved `host` + `apiKey` credentials and the guarded
 * outbound-HTTP client, so every request still goes through the host's egress policy. Plain JS, no npm
 * imports: an installed plugin has none.
 *
 * PUBLIC CONTENT ONLY. Meilisearch is a third party the site owner may not operate, so the provider
 * declares `acceptsRestricted: false`; the indexer already turns restricted documents into removals
 * for it, and `upsert` refuses one per key anyway (defence in depth), so restricted text never
 * reaches a request body.
 *
 * Contract rules and how they map onto Meilisearch:
 * - Methods never throw. A transport fault, a 5xx or an unparseable success is `unknown` (it may
 *   have happened); a definite refusal is `rejected`. No message ever contains the API key.
 * - Writes are asynchronous: `POST /indexes/{uid}/documents` answers `202 {taskUid}`, reported as
 *   `pending` with that task id, settled through `awaitTask` (`GET /tasks/{uid}`).
 * - A removal is a TOMBSTONE document (`deleted: true`, empty title/body/url, no fields), written with
 *   full-replace semantics so none of the old content survives, and every query filters
 *   `deleted = false`. Keeping the tombstone (instead of deleting the document) is what lets a later,
 *   delayed lower revision be recognised as stale instead of resurrecting the document.
 *
 * @typedef {{ siteId: string, workspaceId: string, collection: string, documentId: string }} SearchDocumentKey
 * @typedef {string | number | boolean | readonly string[]} SearchFieldValue
 * @typedef {{ kind: 'public' } | { kind: 'restricted', audiences: readonly string[] }} SearchVisibility
 * @typedef {{ key: SearchDocumentKey, revision: number, locale?: string, url: string, title: string, body: string,
 *   fields?: Readonly<Record<string, SearchFieldValue>>, visibility: SearchVisibility }} SearchDocument
 * @typedef {{ key: SearchDocumentKey, revision: number }} SearchTombstone
 * @typedef {{ text: string, collections?: readonly string[], locale?: string,
 *   filters?: Readonly<Record<string, string | number | boolean>>, audiences?: readonly string[], limit?: number, cursor?: string }} SearchQuery
 * @typedef {{ start: number, end: number }} SearchHighlight
 * @typedef {{ key: SearchDocumentKey, revision: number, url: string, title: string, snippet: string,
 *   highlights: SearchHighlight[], score: number }} SearchHit
 * @typedef {{ key: SearchDocumentKey, revision: number, status: 'applied' | 'stale' | 'pending' | 'rejected', message?: string }} SearchWriteOutcome
 * @typedef {{ key: SearchDocumentKey, revision: number | null, deleted: boolean }} SearchRevisionState
 * @typedef {{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, body?: string, idleTimeoutMs: number }} HttpRequest
 * @typedef {{ status: number, headers: Readonly<Record<string, string>>, bodyText: string }} HttpResponse
 * @typedef {{ send(required: { request: HttpRequest }): Promise<HttpResponse> }} HttpClient
 * @typedef {{ workspaceId: string, siteId: string, indexName: string, credentials: Readonly<Record<string, string>>,
 *   httpClient: HttpClient, timeoutMs: number, now: () => number }} SearchProviderContext
 * @typedef {{ code: string, message: string, retryAfterMs?: number }} ProviderError
 * @typedef {{ status: 'ok', value: any } | { status: 'rejected', error: ProviderError } | { status: 'unknown', error: ProviderError }} ProviderResult
 * @typedef {{ origin: string, apiKey: string, index: string, ctx: SearchProviderContext }} Connection
 * @typedef {{ ok: true, status: number, json: any } | { ok: false, result: ProviderResult, code?: string }} CallResult
 * @typedef {{ revision: number, deleted: boolean }} StoredRevision
 */

const PROVIDER_ID = "meilisearch";

/** Matches the declared capability; the indexer chunks to it, `write()` refuses more (defence). */
const MAX_BATCH = 500;

/** Meilisearch document ids are at most 511 bytes of `[A-Za-z0-9_-]`. */
const MAX_DOCUMENT_ID_LENGTH = 511;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Words of body context Meilisearch keeps around the match in `_formatted.body`. */
const CROP_LENGTH = 30;

/**
 * Highlight delimiters. Control characters a plain-text body never legitimately carries, so the
 * snippet can be rebuilt as plain text plus offsets; markup tags (Meilisearch's default `<em>`)
 * would put HTML into a snippet, which the contract forbids.
 */
const HIGHLIGHT_START = "\u0001";
const HIGHLIGHT_END = "\u0002";
/** Splits a formatted body into text segments and the delimiters themselves (kept by the group). */
const HIGHLIGHT_SPLIT = new RegExp(`([${HIGHLIGHT_START}${HIGHLIGHT_END}])`);

/** First and maximum pause between task polls in `waitForTask`. */
const FIRST_POLL_DELAY_MS = 25;
const MAX_POLL_DELAY_MS = 250;

/**
 * One filterable attribute for every exact-match field, holding `JSON.stringify([name, value])`
 * tokens (one per array element). Why not one `f_<name>` attribute per field: `filterableAttributes`
 * must name each attribute up front (wildcard patterns exist only in recent Meilisearch releases),
 * and field names are only known when documents arrive. The JSON token also keeps exact-match typed:
 * the string `"3"` never matches the number `3`.
 */
const FIELDS_ATTRIBUTE = "f_fields";

const INDEX_SETTINGS = {
  // `id` is filterable because the stale check reads current revisions with `id IN [...]`.
  filterableAttributes: ["id", "site_id", "workspace_id", "collection", "locale", "deleted", FIELDS_ATTRIBUTE],
  searchableAttributes: ["title", "body"],
};

const HIT_ATTRIBUTES = ["site_id", "workspace_id", "collection", "document_id", "revision", "url", "title", "body"];

/** @param {any} value @returns {ProviderResult} */
const ok = (value) => ({ status: "ok", value });
/** @param {string} code @param {string} message @param {number} [retryAfterMs] @returns {ProviderResult} */
const rejected = (code, message, retryAfterMs) => ({ status: "rejected", error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } });
/** @param {string} code @param {string} message @returns {ProviderResult} */
const unknown = (code, message) => ({ status: "unknown", error: { code, message } });

// ---------------------------------------------------------------------------------------------
// Keys and documents
// ---------------------------------------------------------------------------------------------

/**
 * Byte-identical copy of `@jini-ai/search`'s `encodeSearchKey` (a plugin cannot import it); a test
 * pins the two together. Each part is URI-encoded so a `/` inside one part cannot forge another key.
 * @param {SearchDocumentKey} key
 */
function encodeSearchKey(key) {
  return [key.siteId, key.workspaceId, key.collection, key.documentId].map((part) => encodeURIComponent(part)).join("/");
}

/**
 * The Meilisearch document id of a key: base64url of the encoded key. Meilisearch ids allow only
 * `[A-Za-z0-9_-]`; the encoded key is ASCII (URI-encoded), so `btoa` is lossless here.
 * @param {SearchDocumentKey} key
 */
function documentIdOf(key) {
  return btoa(encodeSearchKey(key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/={1,2}$/, "");
}

/** @param {SearchDocumentKey} key */
function keyColumns(key) {
  return { id: documentIdOf(key), site_id: key.siteId, workspace_id: key.workspaceId, collection: key.collection, document_id: key.documentId };
}

/** @param {Readonly<Record<string, SearchFieldValue>>} fields @returns {string[]} */
function fieldTokens(fields) {
  return Object.entries(fields).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((item) => JSON.stringify([name, item])));
}

/** @param {SearchDocument} document */
function toMeiliDocument(document) {
  return {
    ...keyColumns(document.key), revision: document.revision, deleted: false, url: document.url, title: document.title,
    body: document.body, locale: document.locale ?? null, [FIELDS_ATTRIBUTE]: fieldTokens(document.fields ?? {}),
  };
}

/** A tombstone carries the key and revision only: no title, body, url or field can leak through it. @param {SearchTombstone} tombstone */
function toMeiliTombstone(tombstone) {
  return { ...keyColumns(tombstone.key), revision: tombstone.revision, deleted: true, url: "", title: "", body: "", locale: null, [FIELDS_ATTRIBUTE]: [] };
}

// ---------------------------------------------------------------------------------------------
// Transport and error mapping
// ---------------------------------------------------------------------------------------------

/** @param {unknown} value */
const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

/** @param {SearchProviderContext} ctx @returns {Connection | ProviderResult} */
function connect(ctx) {
  const { host, apiKey } = ctx.credentials ?? {};
  if (!isNonEmptyString(host) || !isNonEmptyString(apiKey)) return rejected("not_configured", "Meilisearch needs both a host and an apiKey credential");
  if (!/^https?:\/\//i.test(host)) return rejected("not_configured", "the Meilisearch host must be an http(s) URL");
  let origin = host.trim();
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  return { origin, apiKey, index: encodeURIComponent(ctx.indexName), ctx };
}

/** @param {Connection | ProviderResult} value @returns {value is ProviderResult} */
const isResult = (value) => "status" in value;

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @param {Readonly<Record<string, string>>} headers @param {string} name */
function headerOf(headers, name) {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return found?.[1];
}

/**
 * `Retry-After` in milliseconds: delta-seconds or an HTTP date (measured with the injected clock).
 * @param {string | undefined} value @param {() => number} now @returns {number | undefined}
 */
function parseRetryAfter(value, now) {
  if (value === undefined) return undefined;
  if (/^\s*\d+\s*$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now());
}

/** ` (code)` for a message, or nothing when Meilisearch named no code. @param {string | undefined} code */
const codeSuffix = (code) => (code === undefined ? "" : ` (${code})`);

/** Meilisearch's error `code` (e.g. `index_not_found`), when the body is its JSON error. @param {any} json */
const errorCodeOf = (json) => (typeof json?.code === "string" ? json.code : undefined);

/**
 * A non-2xx answer as a contract result. Messages name the status and Meilisearch's error code only,
 * never the vendor's free-text message (it can echo request content) and never the key.
 * @param {HttpResponse} response @param {any} json @param {() => number} now @returns {ProviderResult}
 */
function mapFailure(response, json, now) {
  const { status } = response;
  const code = errorCodeOf(json);
  const detail = `Meilisearch answered HTTP ${status}${codeSuffix(code)}`;
  if (status >= 500) return unknown("provider_unavailable", detail);
  if (status === 429) return rejected("rate_limited", detail, parseRetryAfter(headerOf(response.headers, "retry-after"), now));
  if (status === 401) return rejected("unauthorized", `${detail}: the API key was not accepted`);
  if (status === 403) return rejected("forbidden", `${detail}: the API key lacks a required permission`);
  if (status === 404) return rejected("not_found", detail);
  if (status >= 400) return rejected(json?.type === "invalid_request" ? "invalid_request" : "provider_error", detail);
  return unknown("unexpected_response", detail);
}

/** A thrown transport error as `unknown`: `timeout` when it looks like an abort or timeout. @param {unknown} error @returns {ProviderResult} */
function mapTransportError(error) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(name) || /timed? ?out|abort/i.test(message)) return unknown("timeout", "the Meilisearch request timed out");
  return unknown("network", "Meilisearch could not be reached");
}

/**
 * One request through the host's guarded client. Never throws.
 * @param {Connection} conn @param {'GET' | 'POST' | 'PATCH' | 'DELETE'} method @param {string} path @param {unknown} [body]
 * @returns {Promise<CallResult>}
 */
async function call(conn, method, path, body) {
  /** @type {HttpRequest} */
  const request = {
    method, url: `${conn.origin}${path}`, idleTimeoutMs: conn.ctx.timeoutMs,
    headers: { Authorization: `Bearer ${conn.apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  let response;
  try {
    response = await conn.ctx.httpClient.send({ request });
  } catch (error) {
    return { ok: false, result: mapTransportError(error) };
  }
  const json = parseJson(response.bodyText);
  if (response.status < 200 || response.status >= 300) {
    const code = errorCodeOf(json);
    return { ok: false, result: mapFailure(response, json, conn.ctx.now), ...(code === undefined ? {} : { code }) };
  }
  if (json === undefined) return { ok: false, result: unknown("unexpected_response", `Meilisearch answered HTTP ${response.status} with a body that is not JSON`) };
  return { ok: true, status: response.status, json };
}

/** @param {CallResult} result @param {string} code */
const failedWith = (result, code) => !result.ok && result.code === code;

/** @param {CallResult} result */
const isIndexNotFound = (result) => failedWith(result, "index_not_found");

/** @param {any} json @returns {string | undefined} */
const taskUidOf = (json) => (Number.isSafeInteger(json?.taskUid) ? String(json.taskUid) : undefined);

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

/**
 * Why a real timer: the contract has no sleep port, and only `ensureIndex`/`dropIndex` wait (their
 * contract is "done when ok"), plus a write's queue drain (an EARLIER task, see `drainQueue`); a
 * write never waits for its own task, it answers `pending` and the indexer settles it.
 * @param {number} ms
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Meilisearch task status as the contract's task state, or `undefined` for anything else.
 * @param {unknown} status @returns {'succeeded' | 'failed' | 'pending' | undefined}
 */
function taskStateOf(status) {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "canceled") return "failed";
  if (status === "enqueued" || status === "processing") return "pending";
  return undefined;
}

/** @param {Connection} conn @param {string} taskId @returns {Promise<{ result: ProviderResult, errorCode?: string }>} */
async function readTask(conn, taskId) {
  const response = await call(conn, "GET", `/tasks/${encodeURIComponent(taskId)}`);
  if (!response.ok) return { result: response.result };
  const state = taskStateOf(response.json?.status);
  if (state === undefined) return { result: unknown("unexpected_response", `Meilisearch task ${taskId} has an unrecognised status`) };
  return { result: ok(state), errorCode: errorCodeOf(response.json?.error) };
}

/**
 * One poll: the task's final result, or `undefined` while it is still pending.
 * `tolerated` names task error codes that still mean success (e.g. deleting an absent index).
 * @param {Connection} conn @param {string} taskId @param {readonly string[]} tolerated @returns {Promise<ProviderResult | undefined>}
 */
async function settledTask(conn, taskId, tolerated) {
  const { result, errorCode } = await readTask(conn, taskId);
  if (result.status !== "ok") return result;
  if (result.value === "succeeded" || (errorCode !== undefined && tolerated.includes(errorCode))) return ok(undefined);
  if (result.value === "failed") return rejected("provider_error", `Meilisearch task ${taskId} failed${codeSuffix(errorCode)}`);
  return undefined;
}

/**
 * Polls a task, pausing between polls, until it settles or `ctx.timeoutMs` (measured with the
 * injected clock) runs out.
 * @param {Connection} conn @param {string} taskId @param {readonly string[]} tolerated @returns {Promise<ProviderResult>}
 */
async function waitForTask(conn, taskId, tolerated) {
  const { now, timeoutMs } = conn.ctx;
  const deadline = now() + timeoutMs;
  let delay = FIRST_POLL_DELAY_MS;
  let settled = await settledTask(conn, taskId, tolerated);
  while (settled === undefined && now() < deadline) {
    await pause(delay);
    delay = Math.min(delay * 2, MAX_POLL_DELAY_MS);
    settled = await settledTask(conn, taskId, tolerated);
  }
  return settled ?? unknown("timeout", `Meilisearch task ${taskId} was still pending after ${timeoutMs} ms`);
}

/** @param {CallResult} response @param {string} what @returns {ProviderResult | string} */
function enqueuedTask(response, what) {
  if (!response.ok) return response.result;
  return taskUidOf(response.json) ?? unknown("unexpected_response", `Meilisearch accepted ${what} without a task uid`);
}

// ---------------------------------------------------------------------------------------------
// Write serialization (revision decisions never overlap)
// ---------------------------------------------------------------------------------------------

/** @type {Map<string, Promise<void>>} The tail of each index's write lane in this process. */
const lanes = new Map();

const settledQuietly = () => undefined;

/**
 * Runs `step` after every earlier write of this process to the same index has enqueued its task.
 * Coordination only, no data: a lane holds a promise and is removed once it drains.
 * @template T @param {string} index @param {() => Promise<T>} step @returns {Promise<T>}
 */
async function inLane(index, step) {
  const run = (lanes.get(index) ?? Promise.resolve()).then(step);
  const tail = run.then(settledQuietly, settledQuietly);
  lanes.set(index, tail);
  try {
    return await run;
  } finally {
    if (lanes.get(index) === tail) lanes.delete(index);
  }
}

/**
 * Waits until no task of this index is still queued, so a revision read afterwards sees every
 * earlier write applied, also one queued by another process or before a restart (the durable
 * coordination is Meilisearch's own task queue). Tasks run in enqueue order, so the newest unfinished
 * task settling means every earlier one did. A failed task is settled too; only an indeterminate wait
 * is returned (as `unknown`: the write is not attempted, and the indexer reconciles it).
 * @param {Connection} conn @returns {Promise<ProviderResult | undefined>}
 */
async function drainQueue(conn) {
  const response = await call(conn, "GET", `/tasks?indexUids=${conn.index}&statuses=enqueued,processing&limit=1`);
  if (!response.ok) return response.result;
  const results = response.json?.results;
  if (!Array.isArray(results)) return unknown("unexpected_response", "Meilisearch listed tasks without a results array");
  if (results.length === 0) return undefined;
  const uid = results[0]?.uid;
  if (!Number.isSafeInteger(uid)) return unknown("unexpected_response", "Meilisearch listed a task without a uid");
  const settled = await waitForTask(conn, String(uid), []);
  return settled.status === "unknown" ? settled : undefined;
}

// ---------------------------------------------------------------------------------------------
// Revisions (the stale check and revisionOf)
// ---------------------------------------------------------------------------------------------

/** @param {any} entry */
const isStoredRevision = (entry) => typeof entry?.id === "string" && Number.isSafeInteger(entry?.revision);

/**
 * Current revisions by Meilisearch id. An absent index holds nothing, so it is an empty map.
 * @param {Connection} conn @param {readonly string[]} ids @returns {Promise<Map<string, StoredRevision> | ProviderResult>}
 */
async function fetchRevisions(conn, ids) {
  const stored = new Map();
  if (ids.length === 0) return stored;
  const body = { filter: `id IN [${ids.map((id) => JSON.stringify(id)).join(", ")}]`, fields: ["id", "revision", "deleted"], limit: ids.length };
  const response = await call(conn, "POST", `/indexes/${conn.index}/documents/fetch`, body);
  if (isIndexNotFound(response)) return stored;
  if (!response.ok) return response.result;
  const results = response.json?.results;
  if (!Array.isArray(results) || !results.every(isStoredRevision)) return unknown("unexpected_response", "Meilisearch returned documents without an id and revision");
  for (const entry of results) stored.set(entry.id, { revision: entry.revision, deleted: entry.deleted === true });
  return stored;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/**
 * Why a key is refused before anything is sent, or `undefined` when it may be written.
 * @param {{ key: SearchDocumentKey, revision: number, visibility?: SearchVisibility }} item @returns {string | undefined}
 */
function refusalOf(item) {
  // Defence in depth: the indexer already turns restricted documents into tombstones for this
  // provider; a restricted document reaching here is still never put in a request body.
  if (item.visibility !== undefined && item.visibility.kind !== "public") return "restricted documents are never sent to Meilisearch (public content only)";
  if (!Number.isSafeInteger(item.revision) || item.revision < 0) return "revision must be a non-negative safe integer";
  if (documentIdOf(item.key).length > MAX_DOCUMENT_ID_LENGTH) return "the document key is too long for a Meilisearch document id";
  return undefined;
}

/**
 * Per-key outcome of the stale check. Revisions strictly increase per key, so an equal or lower
 * incoming revision (also against a tombstone, also against an earlier item of the same batch) is
 * `stale`. Why reading then writing is race-free: the read only ever runs inside the index's write
 * lane AFTER every earlier document task of the index has settled (`drainQueue`), and the queued
 * write is enqueued before the lane is released, so no write can land between this read and the
 * write it decides. Being the indexer's ONE writer alone is not enough: two overlapping indexer
 * calls (an event and a reconcile retry) would otherwise both read before either task ran.
 * @template {{ key: SearchDocumentKey, revision: number, visibility?: SearchVisibility }} I
 * @param {readonly I[]} items @param {Map<string, StoredRevision>} stored @param {(item: I) => object} toDocument
 */
function planWrites(items, stored, toDocument) {
  /** @type {Map<string, number>} */
  const highest = new Map([...stored].map(([id, entry]) => [id, entry.revision]));
  /** @type {Map<string, object>} */
  const send = new Map();
  const outcomes = items.map((item) => {
    const refusal = refusalOf(item);
    if (refusal !== undefined) return { key: item.key, revision: item.revision, status: "rejected", message: refusal };
    const id = documentIdOf(item.key);
    if ((highest.get(id) ?? -1) >= item.revision) return { key: item.key, revision: item.revision, status: "stale" };
    highest.set(id, item.revision);
    send.set(id, toDocument(item));
    return { key: item.key, revision: item.revision, status: "pending" };
  });
  return { outcomes, documents: [...send.values()] };
}

/** @param {readonly { key: SearchDocumentKey, revision: number, visibility?: SearchVisibility }[]} items */
const writableIds = (items) => items.filter((item) => refusalOf(item) === undefined).map((item) => documentIdOf(item.key));

/**
 * The shared write path of `upsert` and `remove`.
 * @template {{ key: SearchDocumentKey, revision: number, visibility?: SearchVisibility }} I
 * @param {SearchProviderContext} ctx @param {readonly I[]} items @param {(item: I) => object} toDocument @returns {Promise<ProviderResult>}
 */
async function write(ctx, items, toDocument) {
  const conn = connect(ctx);
  if (isResult(conn)) return conn;
  if (items.length > MAX_BATCH) return rejected("invalid_request", `Meilisearch accepts at most ${MAX_BATCH} documents per write`);
  return inLane(conn.index, () => decideAndWrite(conn, items, toDocument));
}

/**
 * The serialized half of a write: wait for the index's queue, read revisions, enqueue the write.
 * @template {{ key: SearchDocumentKey, revision: number, visibility?: SearchVisibility }} I
 * @param {Connection} conn @param {readonly I[]} items @param {(item: I) => object} toDocument @returns {Promise<ProviderResult>}
 */
async function decideAndWrite(conn, items, toDocument) {
  const ids = writableIds(items);
  // Nothing writable (every key refused): no revision decision to protect, so no request at all.
  const blocked = ids.length === 0 ? undefined : await drainQueue(conn);
  if (blocked !== undefined) return blocked;
  const stored = await fetchRevisions(conn, ids);
  if (!(stored instanceof Map)) return stored;
  const { outcomes, documents } = planWrites(items, stored, toDocument);
  if (documents.length === 0) return ok({ outcomes });
  const task = enqueuedTask(await call(conn, "POST", `/indexes/${conn.index}/documents?primaryKey=id`, documents), "the documents");
  if (typeof task !== "string") return task;
  return ok({ outcomes, taskId: task });
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

/** A string literal in Meilisearch's filter grammar. @param {string} value */
const filterString = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The query's filter. Site and workspace come from the context, never the query. `audiences` is not
 * filtered on: this index only ever holds public documents (restricted ones are refused on write).
 * @param {SearchProviderContext} ctx @param {SearchQuery} query
 */
function filterOf(ctx, query) {
  const clauses = ["deleted = false", `site_id = ${filterString(ctx.siteId)}`, `workspace_id = ${filterString(ctx.workspaceId)}`];
  if (query.collections !== undefined) clauses.push(`collection IN [${query.collections.map(filterString).join(", ")}]`);
  if (query.locale !== undefined) clauses.push(`locale = ${filterString(query.locale)}`);
  for (const [name, value] of Object.entries(query.filters ?? {})) clauses.push(`${FIELDS_ATTRIBUTE} = ${filterString(JSON.stringify([name, value]))}`);
  return clauses.join(" AND ");
}

/** @param {SearchQuery} query @returns {{ limit: number, offset: number } | string} */
function pageOf(query) {
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return `limit must be an integer from 1 to ${MAX_LIMIT}`;
  const cursor = query.cursor ?? "0";
  if (!/^\d{1,9}$/.test(cursor)) return "cursor is not a cursor of this provider";
  return { limit, offset: Number(cursor) };
}

/**
 * Plain text: markup tags removed, then any stray angle bracket, then control characters turned
 * into spaces (a snippet is rendered by hosts that may not escape it; it must never carry HTML).
 * @param {string} text
 */
const plainText = (text) => text.replace(/<[^<>]*>/g, "").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

/**
 * Rebuilds a plain-text snippet and highlight offsets from a cropped body delimited with
 * {@link HIGHLIGHT_START}/{@link HIGHLIGHT_END}. Each segment is cleaned before offsets are taken,
 * so every range indexes the returned snippet exactly.
 * @param {string} formatted @returns {{ snippet: string, highlights: SearchHighlight[] }}
 */
function snippetOf(formatted) {
  let snippet = "";
  let highlighted = false;
  /** @type {SearchHighlight[]} */
  const highlights = [];
  for (const segment of formatted.split(HIGHLIGHT_SPLIT)) {
    if (segment === HIGHLIGHT_START || segment === HIGHLIGHT_END) {
      highlighted = segment === HIGHLIGHT_START;
      continue;
    }
    const text = plainText(segment);
    if (highlighted && text.length > 0) highlights.push({ start: snippet.length, end: snippet.length + text.length });
    snippet += text;
  }
  return { snippet, highlights };
}

/** @param {any} hit */
const isHit = (hit) => HIT_ATTRIBUTES.every((name) => (name === "revision" ? Number.isSafeInteger(hit?.revision) : typeof hit?.[name] === "string"));

/** @param {any} hit @returns {SearchHit} */
function toHit(hit) {
  const formatted = typeof hit._formatted?.body === "string" ? hit._formatted.body : hit.body;
  return {
    key: { siteId: hit.site_id, workspaceId: hit.workspace_id, collection: hit.collection, documentId: hit.document_id },
    revision: hit.revision, url: hit.url, title: hit.title, ...snippetOf(formatted),
    score: typeof hit._rankingScore === "number" ? hit._rankingScore : 0,
  };
}

/**
 * One page of hits. One extra hit is requested: its presence is what proves a next page exists,
 * without trusting Meilisearch's `estimatedTotalHits` (an estimate, by name).
 * @param {Connection} conn @param {SearchQuery} query @param {{ limit: number, offset: number }} page @returns {Promise<ProviderResult>}
 */
async function search(conn, query, page) {
  const body = {
    q: query.text, filter: filterOf(conn.ctx, query), limit: page.limit + 1, offset: page.offset, attributesToRetrieve: HIT_ATTRIBUTES,
    attributesToCrop: ["body"], cropLength: CROP_LENGTH, attributesToHighlight: ["body"], highlightPreTag: HIGHLIGHT_START,
    highlightPostTag: HIGHLIGHT_END, showRankingScore: true,
  };
  const response = await call(conn, "POST", `/indexes/${conn.index}/search`, body);
  // An index that does not exist yet (never written, or dropped) simply holds nothing.
  if (isIndexNotFound(response)) return ok({ hits: [] });
  if (!response.ok) return response.result;
  const hits = response.json?.hits;
  if (!Array.isArray(hits) || !hits.every(isHit)) return unknown("unexpected_response", "Meilisearch returned hits in an unrecognised shape");
  const more = hits.length > page.limit;
  return ok({ hits: hits.slice(0, page.limit).map(toHit), ...(more ? { nextCursor: String(page.offset + page.limit) } : {}) });
}

// ---------------------------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------------------------

/** @type {any} */
const provider = {
  id: PROVIDER_ID,
  label: "Meilisearch",
  credentialKeys: ["host", "apiKey"],
  capabilities: { acceptsRestricted: false, typoTolerance: true, locales: "any", maxBatch: MAX_BATCH, asyncIndexing: true },

  /** Create the index (an existing one is fine) and apply settings, then wait for the settings task. @param {SearchProviderContext} ctx */
  async ensureIndex(ctx) {
    const conn = connect(ctx);
    if (isResult(conn)) return conn;
    const created = await call(conn, "POST", "/indexes", { uid: ctx.indexName, primaryKey: "id" });
    if (!created.ok && !failedWith(created, "index_already_exists")) return created.result;
    const task = enqueuedTask(await call(conn, "PATCH", `/indexes/${conn.index}/settings`, INDEX_SETTINGS), "the index settings");
    if (typeof task !== "string") return task;
    // Tasks run in enqueue order, so the settings task settling also means the create task ran
    // (its own `index_already_exists` failure is the idempotent case and needs no check).
    return waitForTask(conn, task, []);
  },

  /** Delete the index and wait for it to be gone; an absent index is ok. @param {SearchProviderContext} ctx */
  async dropIndex(ctx) {
    const conn = connect(ctx);
    if (isResult(conn)) return conn;
    const response = await call(conn, "DELETE", `/indexes/${conn.index}`);
    if (isIndexNotFound(response)) return ok(undefined);
    const task = enqueuedTask(response, "the index deletion");
    if (typeof task !== "string") return task;
    return waitForTask(conn, task, ["index_not_found"]);
  },

  /** @param {SearchProviderContext} ctx @param {{ documents: readonly SearchDocument[] }} required */
  upsert(ctx, required) {
    return write(ctx, required.documents, toMeiliDocument);
  },

  /** @param {SearchProviderContext} ctx @param {{ tombstones: readonly SearchTombstone[] }} required */
  remove(ctx, required) {
    return write(ctx, required.tombstones, toMeiliTombstone);
  },

  /** @param {SearchProviderContext} ctx @param {{ query: SearchQuery }} required */
  async query(ctx, required) {
    const conn = connect(ctx);
    if (isResult(conn)) return conn;
    const { query } = required;
    if (typeof query.text !== "string" || query.text.trim() === "") return rejected("invalid_request", "query text must not be empty");
    const page = pageOf(query);
    if (typeof page === "string") return rejected("invalid_request", page);
    // `IN []` matches nothing; answering locally avoids relying on how a server version parses it.
    if (query.collections?.length === 0) return ok({ hits: [] });
    return search(conn, query, page);
  },

  /** @param {SearchProviderContext} ctx @param {{ keys: readonly SearchDocumentKey[] }} required */
  async revisionOf(ctx, required) {
    const conn = connect(ctx);
    if (isResult(conn)) return conn;
    const stored = await fetchRevisions(conn, [...new Set(required.keys.map(documentIdOf))]);
    if (!(stored instanceof Map)) return stored;
    return ok(required.keys.map((key) => {
      const entry = stored.get(documentIdOf(key));
      return { key, revision: entry?.revision ?? null, deleted: entry?.deleted ?? false };
    }));
  },

  /** @param {SearchProviderContext} ctx @param {{ taskId: string }} required */
  async awaitTask(ctx, required) {
    const conn = connect(ctx);
    if (isResult(conn)) return conn;
    return (await readTask(conn, required.taskId)).result;
  },
};

export default provider;
