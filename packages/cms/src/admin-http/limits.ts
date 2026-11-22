/**
 * @file Body-size limits for the content-entry admin routes. This file only declares the cap:
 * Express-mounted routes still enforce it through the host's body-size middleware (which
 * re-measures the parsed body and answers the 413), not through the route adapter.
 *
 * SPEC-002 api.spec.md §4 / behavior.spec.md §4 document: "Request body size ≤ 1 MiB (route
 * layer; exceeding ⇒ 413, EC-05)"; errors.spec.md registers `PAYLOAD_TOO_LARGE` (413) for it.
 * A whole-app JSON parser limit is looser than this bound and not specific to these endpoints,
 * so the cap is declared per route.
 */

/** 1 MiB — api.spec.md §4 / behavior.spec.md §4 documented cap for the content-entry create and update endpoints (`POST_CREATE`, `PAGE_CREATE`, `POST_UPDATE`, `PAGE_UPDATE`). */
export const CONTENT_ENTRY_MAX_BODY_BYTES = 1024 * 1024;
