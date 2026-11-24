import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @file The repo-root `Dockerfile`'s read/write access, extracted out of
 * `server/routes/admin/system/dockerfile-source.ts` (2026-08-15) so the new
 * `deployment_get_dockerfile`/`deployment_set_dockerfile` agent tools (`tool-registrations.ts` in
 * this directory) can read and write the exact same file the admin UI's Dockerfile tab does,
 * without either duplicating the path-resolution rule or creating a `features/deployments ->
 * server/routes/*` back-edge (see `export-run.ts`'s file header for the fuller argument — the same
 * reasoning applies here).
 *
 * Path safety is the entire risk surface of the write half: {@link dockerfilePath} is a fixed,
 * hardcoded path with NO parameter anywhere in this module that could steer it. Neither read/write
 * function below accepts a path argument at all. There is therefore no path-traversal input to
 * sanitize because there is no path input in the first place; every caller (the HTTP route and the
 * agent tool) can only ever affect the file's CONTENTS, never its LOCATION.
 *
 * `process.cwd()` is the resolution root, matching the original route's own rationale: `deps.ts`'s
 * `mediaUploadsDir()` fallback and `defaultContentDbPath()` both already assume the process runs
 * with its cwd at the host repo root (true in dev and in the shipped image's `WORKDIR
 * /workspace/<repo>`), so this inherits an already-established convention rather than introducing a
 * new one.
 *
 * ## 2026-08-15 — optimistic concurrency (Terra audit finding C5)
 *
 * Two independent writers can hold this file open at once: a human editing it in the admin UI's
 * Dockerfile tab, and the `deployment_set_dockerfile` agent tool acting on the assistant's behalf.
 * Before this pass, `writeDockerfileSource` overwrote unconditionally — whichever writer's `PUT`
 * landed last won, silently, with no record that the other writer's edit ever existed. Every
 * snapshot this module returns now carries an `etag` (a content hash, or a fixed sentinel for "no
 * file yet"), and {@link writeDockerfileSourceWithIfMatch} is the strict, checked write path both
 * callers now go through — see that function's own doc for the full decision record, the rejected
 * alternative, and the residual race window it does NOT close.
 *
 * `writeDockerfileSource` (unconditional) stays exported and unchanged for the one caller that must
 * remain unconditional on purpose: this module's own tests (and the route/tool tests) restore the
 * repo's real Dockerfile to its pre-test contents in `t.after()`, and that restore is test cleanup,
 * not a concurrent-editor's write — it has nothing to compare against and nothing to lose by
 * skipping the check.
 */

export interface DockerfileSourceSnapshot {
  exists: boolean;
  /** `null` when `exists` is false — never an empty string standing in for "missing". */
  contents: string | null;
  /**
   * A content-derived optimistic-concurrency token: `"<sha256 of contents>"` (RFC 9110 strong
   * validator quoting) when the file exists, or {@link MISSING_DOCKERFILE_ETAG} when it does not.
   * Always recomputed from whatever is actually on disk at read time — never persisted, never
   * cached across calls. Pass the value observed here back as `ifMatch` to
   * {@link writeDockerfileSourceWithIfMatch} to prove a write is based on the CURRENT contents.
   */
  etag: string;
}

/** The one path either read/write function in this module ever touches — never derived from
 *  caller input. */
function dockerfilePath(): string {
  return join(process.cwd(), "Dockerfile");
}

/** Weak validator (`W/` prefix per RFC 9110) for "no Dockerfile exists yet" — a STATE, not a byte
 *  sequence, so it is deliberately not shaped like a real sha256 hex digest (64 lowercase hex
 *  chars): nothing a real file's contents could hash to would ever collide with this string. */
const MISSING_DOCKERFILE_ETAG = 'W/"missing"';

/** @complexity O(c) in `contents`' byte size — one hash pass. Only existing contents are hashed:
 *  both callers handle absence first (`readDockerfileSource` returns {@link MISSING_DOCKERFILE_ETAG}
 *  before reading), so this takes a string, never null. */
function computeDockerfileEtag({ contents }: { contents: string }, _options = {}): string {
  return `"${createHash("sha256").update(contents, "utf8").digest("hex")}"`;
}

/**
 * Reads the repo-root `Dockerfile`, or reports its absence.
 *
 * @complexity O(f) in the Dockerfile's own byte size — one existence check, one whole-file read,
 * one hash pass over what was just read.
 */
export function readDockerfileSource(): DockerfileSourceSnapshot {
  const path = dockerfilePath();
  if (!existsSync(path)) return { exists: false, contents: null, etag: MISSING_DOCKERFILE_ETAG };
  const contents = readFileSync(path, "utf8");
  return { exists: true, contents, etag: computeDockerfileEtag({ contents }) };
}

/**
 * Overwrites the repo-root `Dockerfile` with `contents` UNCONDITIONALLY, creating it if it does not
 * exist yet. No concurrency check — see this file's header for the one legitimate remaining caller
 * (test cleanup/restore). Production callers (the HTTP route, the agent tool) must go through
 * {@link writeDockerfileSourceWithIfMatch} instead.
 *
 * This ONLY writes bytes to disk — it does not build, validate as a Dockerfile, or trigger any
 * rebuild/redeploy of anything. A syntactically invalid Dockerfile is written as-is; no prior
 * contents are backed up by this function (callers who need the previous contents should read them
 * first via {@link readDockerfileSource}).
 *
 * @param required.contents - The full replacement contents. Not validated as Dockerfile syntax — this is a
 * raw file write, the same trust level a human editing the file directly already has.
 * @returns The snapshot the file now has, for a caller to echo back without a second read.
 * @complexity O(c) in `contents`' own byte size — one whole-file write, one hash pass.
 */
export function writeDockerfileSource({ contents }: { contents: string }, _options = {}): DockerfileSourceSnapshot {
  writeFileSync(dockerfilePath(), contents, "utf8");
  return { exists: true, contents, etag: computeDockerfileEtag({ contents }) };
}

/** {@link writeDockerfileSourceWithIfMatch}'s result: a discriminated union rather than a thrown
 *  error, matching this file's `{exists, contents}`-shaped-return style and this codebase's existing
 *  `{ok:false, error}` convention (e.g. `dockerfile-source.ts`'s own `parseWriteRequestBody`) — a
 *  version mismatch is an expected, name-able outcome for this function's callers, not an
 *  exceptional one, so neither the HTTP route nor the agent tool needs a try/catch just to turn it
 *  into their own 412/conflict-message shape. */
export type DockerfileWriteResult =
  | { ok: true; snapshot: DockerfileSourceSnapshot }
  | { ok: false; reason: "conflict"; current: DockerfileSourceSnapshot };

/**
 * Optimistic-concurrency write: overwrites the repo-root Dockerfile with `contents` ONLY if
 * `ifMatch` still names the file's CURRENT etag. This is the fix for Terra audit finding C5 — the
 * lost-update race where a human in the admin UI and the `deployment_set_dockerfile` agent tool
 * could both save with `writeFileSync`'s unconditional overwrite, and whichever wrote last won with
 * no warning to either party.
 *
 * **Decision record (2026-08-15, owner-approved — do not re-litigate without a fresh decision):**
 * strict. A caller with no `ifMatch` at all is refused with a `400` by the two callers of this
 * function (the HTTP route, the agent tool) BEFORE they ever reach here — this function's own
 * signature requires a string, so "missing" is entirely their concern, not this function's. The
 * rejected alternative was PERMISSIVE: treat a missing `If-Match` as an unconditional write, same as
 * plain {@link writeDockerfileSource}. Rejected because permissive keeps unpatched callers working
 * but leaves the race open through exactly the path that matters most — the agent tool, which is
 * also the one caller that could plausibly retry an unconditional write in a fast loop — and gives
 * the agent no signal it could act on at all.
 *
 * **Residual TOCTOU window (honest, not fully closed by this change):** the freshness read below and
 * the `writeFileSync` inside {@link writeDockerfileSource} are two separate syscalls with no
 * OS-level lock spanning them, and nothing in Node's single-threaded event loop guarantees they run
 * back-to-back with no other macrotask in between. A second writer's own write landing in that gap
 * would still be silently lost. What this DOES close is the much wider window the bug report
 * described: the whole read-edit-save round trip (seconds to minutes of a human typing, or an
 * agent's own multi-step reasoning) collapses to the gap between one synchronous read and one
 * synchronous write in the same function call, with no `await` between them — narrowed by orders of
 * magnitude, not eliminated. Fully closing it needs real file locking (e.g. an OS advisory lock or a
 * library like `proper-lockfile`), deliberately out of scope for this change: a single low-frequency
 * admin-editor file is not worth that dependency today. If an actual collision is ever observed
 * inside this narrowed window, THAT is the trigger to revisit — not a hypothetical.
 *
 * @param required.contents - The full replacement contents, same contract as {@link writeDockerfileSource}.
 * @param required.ifMatch - The etag the caller most recently observed (from a prior
 * `readDockerfileSource`/`writeDockerfileSource*` call). Compared against a FRESH read of disk taken
 * inside this call, never a cached or request-scoped value — comparing against anything else would
 * reintroduce the exact race this function exists to close.
 * @returns `{ok:true, snapshot}` on a successful write, or `{ok:false, reason:"conflict", current}`
 * carrying the disk's actual current contents so the caller can diff and reconcile rather than
 * retry blind.
 * @complexity O(f) — one fresh read (existence check, whole-file read, one hash pass) plus, only on
 * a match, one whole-file write (another hash pass, inside {@link writeDockerfileSource}).
 */
export function writeDockerfileSourceWithIfMatch({ contents, ifMatch }: { contents: string; ifMatch: string }, _options = {}): DockerfileWriteResult {
  // Fresh read, immediately before the write below — see this function's own doc for why a cached
  // or earlier-observed etag must never stand in for this.
  const current = readDockerfileSource();
  if (current.etag !== ifMatch) return { ok: false, reason: "conflict", current };
  return { ok: true, snapshot: writeDockerfileSource({ contents }) };
}
