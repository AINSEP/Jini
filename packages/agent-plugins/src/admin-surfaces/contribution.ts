/**
 * @file Plugs admin surfaces into the existing plugin contribution loader
 * (`../lifecycle/contribution-loader.ts`) and serves their declared files.
 *
 * Why the filename is a parameter: the host names its own contribution file (one host might use
 * `<product>-admin-surfaces.json`), exactly as it does for every other seam; Jini never hardcodes a
 * product prefix. Surfaces are a DATA contribution: nothing is imported into the server process. The
 * loader still applies the shared trust gate (active + shipped digest), and file reads go through
 * the lifecycle's `readTrustedPluginFile`, which resolves symlinks and refuses anything outside the
 * package root.
 */
import type { PluginContributionDefinition } from '../lifecycle/contribution-loader.js';
import type { TrustedPluginPackage } from '../lifecycle/trusted-plugin-files.js';
import { parseAdminSurfacesFile, type AdminSurfaceDescriptor } from './descriptor.js';
import { adminSurfaceFileHeaders } from './sandbox.js';

/** One surface the trust gate admitted, with the package its files are read from. */
export interface LoadedAdminSurface {
  readonly plugin: TrustedPluginPackage;
  readonly descriptor: AdminSurfaceDescriptor;
}

/**
 * The contribution definition for a host-chosen filename. Pass it to the lifecycle's
 * `loadPluginContributions({ workspaceId, definition })`.
 * @complexity O(1) composition; parsing is O(file size).
 */
export function defineAdminSurfaceContribution(required: { readonly filename: string }, _optional: Record<string, never> = {}): PluginContributionDefinition<AdminSurfaceDescriptor, LoadedAdminSurface> {
  return {
    filename: required.filename,
    contribution: 'admin surfaces',
    kind: 'data',
    parse: ({ raw }) => parseAdminSurfacesFile({ raw }),
    load: ({ plugin, descriptor }) => ({ plugin, descriptor }),
  };
}

/**
 * Reads one file of a loaded surface for serving, with the headers it must be served with. Only the
 * entry and the declared `files` are ever read; any other path answers `not-declared` without I/O.
 * @param required.readFile - The lifecycle's `readTrustedPluginFile` (on-disk containment check).
 * @complexity O(f) declared files plus the read.
 */
export async function readAdminSurfaceFile(required: {
  readonly surface: LoadedAdminSurface;
  readonly path: string;
  readonly readFile: (input: { readonly plugin: TrustedPluginPackage; readonly filename: string }) => Promise<string>;
}, _optional: Record<string, never> = {}): Promise<{ readonly ok: true; readonly body: string; readonly headers: Readonly<Record<string, string>> } | { readonly ok: false; readonly reason: 'not-declared' }> {
  const { surface, path } = required;
  if (path !== surface.descriptor.entry && !surface.descriptor.files.includes(path)) return { ok: false, reason: 'not-declared' };
  const body = await required.readFile({ plugin: surface.plugin, filename: path });
  return { ok: true, body, headers: adminSurfaceFileHeaders({ descriptor: surface.descriptor, path }) };
}
