import { existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Match Node's resolved module URL against the invoked path, including directory/file symlinks.
 * Virtual entries such as stdin's `-` must leave imported scripts inert. `entryPath` admits undefined because
 * callers pass process.argv[1] (string | undefined) straight through under exactOptionalPropertyTypes.
 * @returns Whether this module is the filesystem entrypoint; no command is run here.
 * @throws On filesystem errors resolving an existing entry.
 * @complexity One existence check and one realpath lookup, O(path length).
 */
export function isMainModule({ moduleUrl, entryPath }: { moduleUrl: string; entryPath?: string | undefined }, _options = {}): boolean {
  if (!entryPath || !existsSync(entryPath)) return false;
  return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
}
