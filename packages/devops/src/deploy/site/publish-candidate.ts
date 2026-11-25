import { isContainedDeployConfigPath } from "../config-descriptors.js";

/* Deploy-config files a repo may carry, in the order they are consulted for a candidate address.
 *  The vendor paths and their order are declared as plain data by the bundled deploy-config
 *  plugins (`candidatePaths` in `jini-deploy-configs.json`); core adds only the neutral `app.json`.
 *  Operator repos may commit generated configs; generation inputs can remain in a workflow.
 *
 *  This is a SUGGESTION mechanism, never a trust decision: whatever it finds is shown to the owner
 *  for confirmation and is re-validated as a URL before anything is done with it. That is why a
 *  plain scan is adequate here where a real parser would be required to WRITE one (a provisioning codec) — the
 *  cost of a wrong guess is a pre-filled field the owner corrects, not a misdirected publish. */

/**
 * The address to offer the owner, read out of the repo's own deploy config.
 *
 * Deliberately not the process environment: on the machine doing the connecting that names
 * THIS install (usually `localhost`), not the site being published to. The committed config is the
 * one place that names the deployed site, and every install that has ever been deployed has it.
 *
 * @returns The first `https` origin found, or `null` — an install that has never been deployed has
 * no candidate, which is an ordinary empty state and not an error.
 * @complexity O(f · n) for `f` config files of length `n`; f is the number of declared candidate paths.
 */
export async function findCandidateDestination(deps: {
  readonly io: { read(required: { path: string }, optional?: Record<string, never>): string | null | Promise<string | null> };
  readonly publicOriginKey: string;
  /** Absolute path for a repo-relative config file. */
  readonly resolvePath: (required: { relative: string }, optional?: Record<string, never>) => string;
}, { candidatePaths = ["app.json"] }: { readonly candidatePaths?: readonly string[] } = {}): Promise<string | null> {
  const key = deps.publicOriginKey;
  const PUBLIC_URL_PATTERN = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:=]\\s*["']?(https://[^"'\\s,]+)`);
  for (const relative of candidatePaths) {
    if (!isContainedDeployConfigPath({ value: relative })) continue;
    const contents = await deps.io.read({ path: deps.resolvePath({ relative }) });
    if (contents !== null) {
      const found = PUBLIC_URL_PATTERN.exec(contents)?.[1];
      if (found !== undefined) return found;
    }
  }
  return null;
}
