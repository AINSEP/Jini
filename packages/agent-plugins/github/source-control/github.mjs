// @ts-check
import { BACKUP_CLIENT_OPTIONS, BACKUP_INLINE_TEXT_MAX_BYTES, createBackupPusher } from "./backup-push.mjs";
import { createSiteCommitter } from "./commit-site.mjs";
import { createFileWriter, createGitDataClient } from "./write-files.mjs";

/**
 * @file GitHub source-control provider for the `github` Agent Plugin.
 *
 * Core knows only the generic contract (`apps/website/src/features/source-control/provider-module.ts`)
 * and loads this file through its source-control registry, because the host shipped it. Everything
 * GitHub-specific about committing the site, writing files through a saved credential, pushing a
 * site backup and reading a token's account name lives in this directory. Plain JS, no npm imports:
 * an installed plugin has none, so everything else comes from the kit core passes in.
 *
 * @typedef {{
 *   repositoryPaths: {
 *     normalizeFolder(required: { folder?: unknown }): string,
 *     prefixPath(required: { folder?: string, path: string }): string,
 *     contains(required: { folder?: string, path: string }): boolean,
 *   },
 *   fetch(url: string, init: RequestInit): Promise<Response>,
 *   redirectGuardInit(init: RequestInit): RequestInit,
 *   assertNotRedirected(response: Response, hostName: string): void,
 *   isRedirectRefusal(error: unknown): boolean,
 *   httpClient: { send(request: { method: string, url: string, headers: Record<string, string>, body?: string,
 *     timeoutMs: number }): Promise<{ status: number, bodyText: string, headers?: Record<string, string> }> },
 *   describeTransportError(error: unknown): { refusal: string | undefined, logDetail: string },
 *   sleep?(ms: number): Promise<void>,
 * }} Kit
 */

const GITHUB_API = "https://api.github.com";

/** Bounds the account-name probe: a human is waiting on the credential form. */
const ACCOUNT_LABEL_PROBE_TIMEOUT_MS = 10_000;

/** GitHub owner/org name: alphanumeric, may contain single hyphens, cannot start with one, capped at
 *  GitHub's own 39-character username limit. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub repo name: letters, digits, `.`/`-`/`_`, capped at GitHub's own 100-character limit. */
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

export default {
  supportsFolder: true,
  /**
   * GitHub's own owner/repo rules, checked before anything is built or sent. Core applies its
   * generic one-path-segment rule after this.
   * @param {{ owner: string, repo: string }} target
   * @returns {string | null}
   */
  validateTarget({ owner, repo }) {
    if (!OWNER_PATTERN.test(owner)) return `invalid GitHub owner '${owner.slice(0, 60)}'`;
    if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") return `invalid GitHub repo '${repo.slice(0, 100)}'`;
    return null;
  },

  /** @param {{ kit: Kit }} context */
  create({ kit }) {
    const git = createGitDataClient(kit);
    const writer = createFileWriter(git);
    const backup = createBackupPusher(createGitDataClient(kit, BACKUP_CLIENT_OPTIONS));
    return {
      commitSite: createSiteCommitter(kit),

      /**
       * `GET /user` -> `login`, the public name GitHub prints in every profile URL (never email, plan
       * or org membership). Best effort: any failure is `null`, never a throw.
       * @param {string} token
       */
      async readAccountLabel(token) {
        try {
          const resp = await kit.fetch(`${GITHUB_API}/user`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(ACCOUNT_LABEL_PROBE_TIMEOUT_MS),
          });
          if (!resp.ok) return null;
          const body = await resp.json();
          const login = typeof body === "object" && body !== null ? body.login : undefined;
          return typeof login === "string" && login !== "" ? login : null;
        } catch {
          return null;
        }
      },

      planFileWrite: writer.planFileWrite,
      commitFiles: writer.commitFiles,
      backupInlineTextMaxBytes: BACKUP_INLINE_TEXT_MAX_BYTES,
      inspectBackupRepository: backup.inspectBackupRepository,
      uploadBackupBlob: backup.uploadBackupBlob,
      commitBackupTree: backup.commitBackupTree,
    };
  },
};
