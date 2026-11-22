/**
 * @file The one rule that stands between a two-click card overlay and `fs.rm(dir, {recursive: true,
 * force: true})`.
 *
 * `project-ipc.ts`'s `handleDelete` erases a project's whole install directory — `content.db`,
 * `uploads/`, `themes/`, `agent-plugins/` — with no backup and no OS trash, because that is the
 * honest meaning of "delete this project" for a project the app itself provisioned. It is NOT the
 * honest meaning for a directory the app merely ADOPTED. `main.ts` seeds the Projects screen with
 * `<repo>/sites/example-project` (`seedDevFallbackSite`), a git-tracked folder holding a real production
 * database that this app did not create a single byte of; the moment that folder classifies as a
 * site, a card for it appears and two clicks would destroy it.
 *
 * **Three independent tests, all of which must pass before anything is erased:**
 *
 * 1. *Provenance* (`createdOrigin`) — only a row this app recorded as `created` is erasable.
 *    This is the general rule: it protects every adopted folder anywhere on the disk, not just the
 *    ones that happen to live in a checkout.
 * 2. *Containment* — nothing under `protectedRoot` is erasable, whatever its row claims. This is the
 *    backstop for the specific asset at risk, and it survives a row whose provenance is wrong:
 *    a hand-edited `desktop-projects.json`, a future seeding path that forgets to say `adopted`, or
 *    an operator who points "+ Create website" at a folder inside the checkout.
 * 3. *Identity* ({@link isStillTheRecordedDirectory}) — the site actually living at that path right now
 *    must be the same site whose creation produced the row. Tests 1 and 2 are both properties of the
 *    ROW, and a row is a path string in a JSON file; a path is not an identity. An operator who moves
 *    their site elsewhere and lets something else take its old path leaves a row whose provenance and
 *    containment are both still perfectly true about a directory this app never made — and the card
 *    even renders under the NEW site's name, since `readSiteName` reads whatever `config.json` is
 *    there now. No amount of reasoning about the row can catch
 *    it: only asking the live directory who it is can.
 *
 * No test subsumes another, which is why all three are here rather than one. All fail CLOSED:
 * anything this module cannot positively prove safe is refused, and a refusal costs the operator a
 * leftover folder they can delete in Finder, while a wrong permission costs them their content.
 *
 * **Consequence of test 3, stated rather than hidden:** a `created` row written before identity was
 * recorded carries no `identity`, so it is refused and its delete removes the card only. That is the
 * fail-closed direction — the alternative would be to trust exactly the rows this test exists to
 * distrust — and it self-corrects for every project created from here on.
 *
 * No `electron` import, so all of it is testable under plain `node --test` — same convention as
 * `tracked-sites.ts` and `site-dir-store.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { canonicalNodeDirectory } from "./directory-workspace.js";

/**
 * The identity a site carries in its own directory — the configured marker file's identity field, the UUID
 * the host stamps once at creation and nothing afterwards rewrites.
 *
 * Chosen over an inode/device pair on purpose. Both distinguish "the site I created" from "whatever
 * is at that path now", but `st_dev` is a property of the MOUNT, not of the directory: it is free to
 * change across a reboot or a re-mounted external volume, which would silently downgrade every
 * later delete of a perfectly ordinary project to a card-removal. The recorded identity is content the site
 * carries with it — it survives a move, a reboot, a copy, and a restore from backup, and a
 * DIFFERENT site has a different one, which is exactly the discrimination this guard needs.
 *
 * @returns the site's id, or `null` when the directory is absent, unreadable, holds no
 *   marker metadata, holds one that is not JSON, or holds one with no usable identity — every one
 *   of which is "cannot prove identity", and all of which the caller must treat identically.
 * @complexity O(1) — one file read.
 */
export function readDirectoryIdentity(
  { directory, markerFile, identityField }: { directory: string; markerFile: string; identityField: string },
  { readText = (file: string) => fs.readFileSync(file, "utf8") }: { readText?: ((file: string) => string) | undefined } = {},
): string | null {
  return orFallbackSync({ work: () => {
    const meta = JSON.parse(readText(path.join(directory, markerFile))) as Record<string, unknown> | null;
    const identity = meta?.[identityField];
    return typeof identity === "string" && identity !== "" ? identity : null;
  }, fallback: null, step: "directory identity marker" });
}

/**
 * Whether the site living at `row.directory` right now is the one whose creation wrote `row`.
 *
 * A row with no recorded `identity` (written before this test existed, or hand-edited) can never
 * satisfy this — it has nothing to compare — so it is refused rather than grandfathered.
 *
 * @complexity O(1) beyond {@link readDirectoryIdentity}'s own file read.
 */
function isStillTheRecordedDirectory(
  { row, markerFile, identityField }: { row: { directory?: unknown; identity?: unknown } | undefined; markerFile: string; identityField: string },
  { readText }: { readText?: ((file: string) => string) | undefined } = {},
): boolean {
  if (typeof row?.identity !== "string" || row.identity === "") return false;
  return readDirectoryIdentity({ directory: row.directory as string, markerFile, identityField }, { readText }) === row.identity;
}

/**
 * `target` with every symlink resolved and the path normalized, so a containment test cannot be
 * defeated by `..`, a trailing slash, a relative segment, or a site dir that is itself a symlink
 * pointing into the repo.
 *
 * `realpathSync.native` rather than the JS implementation on purpose: on macOS the native call also
 * returns the directory's canonical on-disk CASE, so a case-insensitive filesystem cannot be used to
 * smuggle `/repo/Sites/example-project` past a comparison against `/repo/sites`.
 *
 * A path whose LEAF does not exist still resolves correctly: the deepest existing ancestor is
 * resolved and the remaining segments are re-appended to it. Resolving only whole paths would leave
 * a moved-or-deleted site dir under a symlinked checkout comparing as OUTSIDE the repo it is plainly
 * in — the wrong answer in the dangerous direction — because one side of the comparison would have
 * followed the symlink and the other would not.
 *
 * The canonicalizer returns the resolved absolute path. It falls back to `path.resolve`'s plain normalization (which
 *   still collapses `..` and trailing slashes) only when not even the filesystem root resolves.
 * It takes O(depth) stat calls, worst case one per path segment.
 *
 * Whether `target` is `container` itself or lives somewhere beneath it, compared on resolved real
 * paths.
 *
 * `path.relative` rather than a `startsWith` prefix test: `startsWith` would report `/repo-backup`
 * as being inside `/repo` (a false positive that refuses a legitimate delete) and would be defeated
 * by any `..` the caller had not normalized away. A relative path that is empty means "the same
 * directory"; one that neither starts with `..` nor is itself absolute means "below".
 *
 * @complexity O(depth) — two {@link canonicalNodeDirectory} calls plus a string compare.
 */
export function isInsideDirectory({ target, container }: { target: string; container: string }, _optional: Record<string, never> = {}): boolean {
  const relative = path.relative(
    canonicalNodeDirectory({ path: path.resolve(container) }, { realpath: fs.realpathSync.native, fallbackOnAnyError: true }),
    canonicalNodeDirectory({ path: path.resolve(target) }, { realpath: fs.realpathSync.native, fallbackOnAnyError: true }),
  );
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Whether deleting `row`'s project may erase its directory from disk, or must only drop its card.
 *
 * The single authority for that decision. `handleDelete` calls it, and `buildSiteRecord` calls it
 * too so the renderer can label the button with what will actually happen — the UI must never be
 * left to re-derive this rule for itself and drift from it.
 *
 * @param required.row a row from `readTrackedSites`, whose `origin` is already normalized fail-closed by that
 *   function. `identity` is present only on rows `trackSite` wrote as `created` once identity
 *   recording existed. Typed loosely (every field `unknown`) because a hand-edited registry file, or
 *   a row written before a field existed, must be refused rather than crash this check.
 * @param required.protectedRoot the host-protected checkout root. A missing or non-string value refuses everything:
 *   containment cannot be PROVEN without it, and this module never permits what it cannot prove.
 *   `main.ts` always supplies it, so that arm is a guard against a future miswiring, not a
 *   reachable operator state.
 * @returns `true` only when the app created the directory, it lives outside the repo, AND the site
 *   at that path is still the one the app created.
 * @complexity O(depth) — {@link isInsideDirectory}'s cost plus one file read, and only for a
 *   `created` row.
 */
export function mayEraseDirectory(
  { row, createdOrigin, protectedRoot, markerFile, identityField }: {
    /** A recorded row may be garbage, missing, or of the wrong type (a hand-edited registry
     * or a fail-closed fixture); refuse rather than throw or admit it. */
    row: { directory?: unknown; origin?: unknown; identity?: unknown } | undefined;
    createdOrigin: string;
    /** The protected-root input is as loosely typed as the recorded row fields. */
    protectedRoot: unknown;
    markerFile: string; identityField: string;
  },
  { readText }: { readText?: ((file: string) => string) | undefined } = {},
): boolean {
  if (row?.origin !== createdOrigin) return false;
  if (typeof protectedRoot !== "string" || protectedRoot === "") return false;
  if (!isStillTheRecordedDirectory({ row, markerFile, identityField }, { readText })) return false;
  // The identity check above refuses an undefined row, but does not narrow it for TypeScript.
  return !isInsideDirectory({ target: row!.directory as string, container: protectedRoot });
}
