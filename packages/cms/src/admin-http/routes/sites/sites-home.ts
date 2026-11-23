/**
 * Sites-folder settings routes: read the sites settings and choose the creation home, authorized at
 * the same boundary as Sites mutations (`system.read`/`system.write` on `site-registry`).
 *
 * The deployment gate (local sites management on/off) is answered before any authorization, and
 * every folder refusal is answered after it, so a caller without the permission learns nothing
 * about the host's folders. Filesystem inspection is the host's (`SitesDirectoryProbe`); the
 * rules over its answers live here.
 */
import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import type { SitesHomeSetResponse } from '@jini-ai/core/contracts/site/cms-sites';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

const PREFIX = '/api/admin/v1/workspaces/:workspaceId/system/sites';
const FOLDER_PATH_REFUSAL = 'Choose an absolute folder path for sites settings.';

/** The host's folder inspection. `kind` throws any probe failure other than "not found" (an I/O
 * error is the host 500, never a public refusal). */
export interface SitesDirectoryProbe {
  isAbsolute(required: { directory: string }): boolean;
  kind(required: { directory: string }): 'directory' | 'other' | 'missing';
  parentExists(required: { directory: string }): boolean;
}

/** The deployment gate both settings routes check first. */
export interface SitesSettingsGateDeps { switcherEnabled: () => boolean }

/** What the settings read route reads. */
export interface SitesConfigReadRouteDeps extends SitesSettingsGateDeps {
  workspace: { config(required: Record<string, never>): unknown };
}

/** What the home route reads. */
export interface SitesHomeSetRouteDeps extends SitesSettingsGateDeps {
  workspace: { setHome(required: { path: string }): unknown };
  directories: SitesDirectoryProbe;
}

/** The principal fields the host ports read. */
export interface SitesSettingsPrincipal { id: string }

/** The settings patch fields that name folders. */
export interface SitesSettingsDirectoryPatch { sitesHome?: unknown; siteRoots?: readonly string[] }

/** Deployment gate, then the permission. A mount without an authorizer is a wiring bug: fail closed. @complexity O(1). */
async function admitSitesSettings(
  { deps, authorize, permission }: { deps: SitesSettingsGateDeps; authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!deps.switcherEnabled()) rejectRoute({ status: 403, error: 'Local sites management is disabled.' });
  if (!authorize) throw new Error('sites settings route has no authorizer');
  await authorize({ permission, entityType: 'site-registry' });
}

/** The folder's shape, before inspecting the filesystem: malformed input is a refusal, not an I/O error. @complexity O(path). */
export function parseSitesSettingsDirectory({ directory, directories }: { directory: unknown; directories: SitesDirectoryProbe }, _optional: Record<string, never> = {}): string {
  if (typeof directory !== 'string' || !directory.trim() || !directories.isAbsolute({ directory }) || directory.includes('\0')) rejectRoute({ status: 400, error: FOLDER_PATH_REFUSAL });
  return directory;
}

/** Roots must exist, and a new home needs its parent mounted: a missing volume must never become a
 * newly-created boot-disk directory. @complexity O(1) probes per directory. */
function validateSitesDirectory({ directory, required, directories }: { directory: string; required: boolean; directories: SitesDirectoryProbe }, _optional: Record<string, never> = {}): void {
  const kind = directories.kind({ directory });
  if (kind === 'other') rejectRoute({ status: 400, error: 'Sites folder must be a directory.' });
  if (kind === 'missing' && (required || !directories.parentExists({ directory }))) {
    rejectRoute({ status: 400, error: `Sites folder is unavailable: ${directory}. Mount it or choose an existing local folder.` });
  }
}

/** Both settings writes use absolute paths: the home (may be new) and every root (must exist). @complexity O(roots). */
export function validateSitesSettingsDirectories({ patch, directories }: { patch: SitesSettingsDirectoryPatch; directories: SitesDirectoryProbe }, _optional: Record<string, never> = {}): void {
  for (const [directory, required] of [
    ...(patch.sitesHome !== undefined ? [[patch.sitesHome, false] as const] : []),
    ...(patch.siteRoots ?? []).map((root) => [root, true] as const),
  ]) {
    validateSitesDirectory({ directory: parseSitesSettingsDirectory({ directory, directories }), required, directories });
  }
}

/** `GET .../system/sites/config` — the stored sites settings. */
export const sitesConfigReadRoute = defineJsonRoute<Record<string, never>, unknown, SitesConfigReadRouteDeps, SitesSettingsPrincipal>({
  method: 'get',
  path: `${PREFIX}/config`,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await admitSitesSettings({ deps, authorize, permission: 'system.read' });
    return ok({ value: deps.workspace.config({}) });
  },
});

/** `PUT .../system/sites/home` — choose the folder new sites are created in. */
export const sitesHomeSetRoute = defineJsonRoute<{ path: unknown }, SitesHomeSetResponse, SitesHomeSetRouteDeps, SitesSettingsPrincipal>({
  method: 'put',
  path: `${PREFIX}/home`,
  parse: (raw) => ok({ value: { path: (raw.body as { path?: unknown } | null | undefined)?.path } }),
  handle: async ({ input, deps, authorize }) => {
    await admitSitesSettings({ deps, authorize, permission: 'system.write' });
    if (input.path === undefined) rejectRoute({ status: 400, error: FOLDER_PATH_REFUSAL });
    validateSitesSettingsDirectories({ patch: { sitesHome: input.path }, directories: deps.directories });
    return ok({ value: { home: deps.workspace.setHome({ path: input.path as string }) } });
  },
});
