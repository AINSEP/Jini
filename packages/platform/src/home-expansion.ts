/**
 * @module home-expansion
 *
 * Shared shorthand-expander for env-supplied directory paths. Any port that
 * resolves a data/config directory from an environment variable (sandbox
 * roots, resource paths, …) should route through this so a launcher passing
 * `$HOME/.myapp` always lands at the same expanded path regardless of which
 * port did the resolving.
 *
 * Recognized shorthands (case-sensitive):
 *   '~'        | '~/...'   | '~\\...'
 *   '$HOME'    | '$HOME/...' | '$HOME\\...'
 *   '${HOME}'  | '${HOME}/...' | '${HOME}\\...'
 *
 * Anything else (absolute paths, plain relative paths, $OTHER variables) is
 * returned unchanged. Both forward and back slashes are accepted in the
 * prefix so a Windows launcher passing `$HOME\.myapp` behaves the same as a
 * Unix launcher passing `$HOME/.myapp`; the result is rebuilt via
 * `path.join` so the platform separator is correct in the output regardless
 * of which the input used.
 */
import os from 'node:os';
import path from 'node:path';

const HOME_BARE_TOKENS: ReadonlySet<string> = new Set(['~', '$HOME', '${HOME}']);
const HOME_PREFIX_RE = /^(~|\$\{HOME\}|\$HOME)[/\\](.*)$/;

/**
 * Expands a leading `~`, `$HOME`, or `${HOME}` shorthand to the real home
 * directory. Values without one of those prefixes pass through unchanged.
 *
 * @param raw - The raw, possibly shorthand-prefixed path.
 * @returns The expanded path, or `raw` unchanged if it carried no shorthand.
 */
export function expandHomePrefix({ raw }: { raw: string }, _optional: Record<string, never> = {}): string {
  const home = os.homedir();
  if (HOME_BARE_TOKENS.has(raw)) return home;
  const match = HOME_PREFIX_RE.exec(raw);
  // match[2] comes from the `(.*)$` capture group, which always matches
  // (possibly empty) once the overall regex matches — never undefined in
  // practice, so a non-null assertion documents that instead of a `?? ''`
  // fallback with no reachable path.
  if (match) return path.join(home, match[2]!);
  return raw;
}

/**
 * Expands a home-directory shorthand (see {@link expandHomePrefix}) and then
 * resolves the result against `projectRoot` if it is still relative.
 *
 * @param raw - The raw, possibly shorthand-prefixed or relative path.
 * @param projectRoot - The root a relative `raw` is resolved against.
 * @returns An absolute path.
 */
export function resolveProjectRelativePath({ raw, projectRoot }: { raw: string; projectRoot: string }, _optional: Record<string, never> = {}): string {
  const expanded = expandHomePrefix({ raw });
  return path.isAbsolute(expanded) ? expanded : path.resolve(projectRoot, expanded);
}
