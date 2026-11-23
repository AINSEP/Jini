/**
 * @file The TypeScript-only backslide guard for the host's desktop app: the shell was converted from
 * JavaScript to TypeScript on 2026-09-12
 * (`ADS-memory/reports/2026-09-12-desktop-typescript-migration-plan.md`, Phase 5 item 2 —
 * "Backslide guard"), and this is the gate that keeps a `.js`/`.mjs`/`.cjs` file from silently
 * reappearing anywhere under the host's desktop app. Pure decision logic only, so the policy is testable
 * under plain `node --test` — the filesystem/git listing that gathers candidate paths lives in
 * `scripts/check-js-backslide.ts`.
 *
 * ## Why an allowlist of exact paths, not a directory or filename-pattern exemption
 *
 * The migration left one JavaScript-family file, `src/speech/preload-speech.cjs`: Electron's
 * sandboxed preload loader never strips types and rejects ESM (migration plan Phase 0, probe P2), so
 * a `.ts`/`.cts` preload cannot be loaded directly. That file is now `src/speech/preload-speech.cts`,
 * compiled by `tsconfig.preload.json` to the gitignored `dist/speech/preload-speech.cjs` the same way
 * `src/preload/preload.mts` already was (the migration's rule 1 bars a compile step for the MAIN
 * process, not for a preload). Its allowlist entry is transitional — see `scripts/check-js-backslide.ts`'s
 * `ALLOWLIST`. Naming a file exactly — never "anything under src/speech" or "anything named
 * preload-*" — means a second `.cjs` landing anywhere, including a sibling in the very same
 * directory, still fails the gate instead of riding in on an existing exemption.
 */

/** Extensions this guard treats as JavaScript-family. Deliberately excludes `.jsx`/`.tsx` — the
 *  migration converted the main process, not the renderer's component files, and those are out of
 *  this gate's scope. */
const JS_FAMILY_EXTENSIONS = [".js", ".mjs", ".cjs"] as const;

/**
 * Every path in `paths` that is a JavaScript-family file and is not named exactly in `allowlist`.
 *
 * @param paths repo-relative file paths to check — the shape `git ls-files -co --exclude-standard`
 *   produces, so gitignored build output (`dist/`, `node_modules/`, packaged release output) never
 *   reaches this function at all.
 * @param allowlist exact repo-relative paths that may stay JavaScript-family, matched verbatim
 *   against the whole path — never a prefix, directory, or filename pattern — so a new offender
 *   cannot ride in on an existing exemption's directory or naming shape. Defaults to empty: no
 *   implicit exemption exists unless the caller states one.
 * @returns the offending paths, in the order they were given.
 * @complexity O(n * m) in `paths` and `allowlist`; both are single digits in practice (one
 *   allowlist entry today), so a `Set` lookup would only trade a trivially cheap linear scan for
 *   more code.
 */
export function jsBackslideOffenders({ paths }: { paths: readonly string[] }, { allowlist = [] }: { allowlist?: readonly string[] } = {}): string[] {
  return paths.filter(
    (path) => JS_FAMILY_EXTENSIONS.some((extension) => path.endsWith(extension)) && !allowlist.includes(path)
  );
}
