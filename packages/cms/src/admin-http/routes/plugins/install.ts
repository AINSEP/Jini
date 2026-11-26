import { defineJsonRoute, ok, routeReply, type RouteInputContext, type JsonRouteAuthorize, type RouteReply, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import type { PluginInstallInput, PluginInstallPreview, PluginInstallerPort } from '@jini-ai/core/contracts/site/host-node';

const conflicts: ReadonlySet<string> = new Set(['PLUGIN_SHADOWS_BUILT_IN', 'PLUGIN_ID_CONFLICT', 'PLUGIN_IN_TRASH', 'PLUGIN_ENABLED', 'PLUGIN_VERSION_EXISTS', 'PLUGIN_DOWNGRADE', 'PLUGIN_CHANGED_SINCE_PREVIEW', 'PLUGIN_INSTALL_BUSY']);
const REVIEWED_DIGEST = /^sha256-[a-f0-9]{64}$/;
const INPUT_INVALID = 'PLUGIN_INSTALL_INPUT_INVALID';
type InstallRoute = { zip: boolean; preview: boolean };
export interface InstallRefusal { readonly status: number; readonly code: string; readonly error: string }
type InstallOptions = Readonly<Record<string, unknown>>;

const LOCAL_INSTALL_DISABLED: InstallRefusal = { status: 403, code: 'PLUGIN_LOCAL_INSTALL_DISABLED', error: 'Local folder installs are disabled on this server.' };
const OPTIONS_INVALID: InstallRefusal = { status: 400, code: INPUT_INVALID, error: 'Valid replacement options and the reviewed digest are required.' };

/** `replace` may be absent, a JSON boolean (folder body) or "true"/"false" (ZIP query string). */
function validReplacement({ replacement, zip }: { replacement: unknown; zip: boolean }, _optional = {}): boolean {
  if (replacement === undefined) return true;
  return zip ? replacement === 'true' || replacement === 'false' : typeof replacement === 'boolean';
}

/** Anything but `{ kind: "folder", path: <non-blank string> }` is refused; the path goes on untrimmed. */
function readFolderSource({ source }: { source: unknown }, _optional = {}): { ok: false; refusal: InstallRefusal } | { ok: true; sourceDir: string } {
  const folder = source as { kind?: unknown; path?: unknown } | null | undefined;
  if (folder?.kind !== 'folder' || typeof folder.path !== 'string' || !folder.path.trim()) return { ok: false, refusal: { status: 400, code: INPUT_INVALID, error: 'A folder source is required.' } };
  return { ok: true, sourceDir: folder.path };
}

export function zipParserRefusal({ error, uploadLimitText }: { error: unknown; uploadLimitText: string }, _optional = {}): InstallRefusal {
  return error !== null && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large'
    ? { status: 413, code: 'PLUGIN_PACKAGE_TOO_LARGE', error: uploadLimitText }
    : { status: 400, code: 'PLUGIN_ARCHIVE_INVALID', error: 'ZIP upload could not be read.' };
}

/** Validates the options, then reads the ZIP upload or folder source into the installer's input. */
async function readInstallInput({ body, query, route, readZipUpload }: {
  body: unknown; query: Record<string, unknown>; route: InstallRoute;
  readZipUpload: ((required: Record<string, never>) => Promise<{ ok: true; archive: Uint8Array } | { ok: false; refusal: InstallRefusal }>) | undefined;
}): Promise<{ ok: false; refusal: InstallRefusal } | { ok: true; kind: 'preview'; input: PluginInstallInput } | { ok: true; kind: 'apply'; input: PluginInstallInput & { expectedDigest: string } }> {
  // ZIP options ride the query string; folder options are the JSON body.
  const options = (route.zip ? query : body) as InstallOptions | undefined;
  // `!options` is a wiring guard: `req.body` is undefined when the route is mounted without the host JSON parser.
  if (!options || !validReplacement({ replacement: options.replace, zip: route.zip })) return { ok: false, refusal: OPTIONS_INVALID };
  const expectedDigest = options.expectedDigest;
  let digest: { kind: 'preview' } | { kind: 'apply'; expectedDigest: string };
  if (route.preview) digest = { kind: 'preview' };
  else if (typeof expectedDigest === 'string' && REVIEWED_DIGEST.test(expectedDigest)) digest = { kind: 'apply', expectedDigest };
  else return { ok: false, refusal: OPTIONS_INVALID };
  const source = route.zip ? await readZipUpload!({}) : readFolderSource({ source: options.source });
  if (!source.ok) return source;
  const input: PluginInstallInput = 'archive' in source ? { archive: source.archive, replace: options.replace === true || options.replace === 'true' } : { sourceDir: source.sourceDir, replace: options.replace === true || options.replace === 'true' };
  if (digest.kind === 'preview') return { ok: true, kind: 'preview', input };
  return { ok: true, kind: 'apply', input: { ...input, expectedDigest: digest.expectedDigest } };
}

async function handleInstall({ raw, route, deps, context, authorize }: {
  raw: Pick<RouteInputContext, 'body' | 'query'>; route: InstallRoute;
  deps: {
    installer(required: Record<string, never>): PluginInstallerPort | undefined;
    readZipUpload: Parameters<typeof readInstallInput>[0]['readZipUpload'];
    onInstalled: ((required: { actorId: string; pluginId: string }) => void) | undefined;
  };
  context: { id: string } | undefined; authorize: JsonRouteAuthorize | undefined;
}): Promise<RouteReply<{ plugin: PluginInstallPreview } | { code: string; error: string }>> {
  if (!context || !authorize) throw new Error('plugin install route has no authenticated principal or authorizer');
  await authorize({ permission: 'admin.plugins.enable' });
  const installer = deps.installer({});
  if (!installer) return routeReply({ status: LOCAL_INSTALL_DISABLED.status, body: { code: LOCAL_INSTALL_DISABLED.code, error: LOCAL_INSTALL_DISABLED.error } });
  const read = await readInstallInput({ ...raw, route, readZipUpload: deps.readZipUpload });
  if (!read.ok) return routeReply({ status: read.refusal.status, body: { code: read.refusal.code, error: read.refusal.error } });
  const result = read.kind === 'preview' ? await installer.preview(read.input) : await installer.install(read.input);
  if (read.kind === 'apply') deps.onInstalled!({ actorId: context.id, pluginId: result.id });
  return routeReply({ status: route.preview ? 200 : 201, body: { plugin: result } });
}

export function pluginInstallErrorStatus({ code }: { code: string }, _optional = {}): number {
  if (code === 'PLUGIN_INSTALL_RECOVERY_REQUIRED') return 500;
  return conflicts.has(code) ? 409 : 400;
}

export const folderPluginInstallPreviewRoute = defineJsonRoute<{ body: unknown; query: Record<string, unknown> }, unknown, {
  installer(required: Record<string, never>): PluginInstallerPort | undefined;
}, { id: string }>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/plugins/install/preview',
  parse: raw => ok({ value: { body: raw.body, query: raw.query } }),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await handleInstall({ raw: input, route: { zip: false, preview: true }, deps: { ...deps, readZipUpload: undefined, onInstalled: undefined }, context, authorize }) }),
});
export const folderPluginInstallRoute = defineJsonRoute<{ body: unknown; query: Record<string, unknown> }, unknown, {
  installer(required: Record<string, never>): PluginInstallerPort | undefined;
  onInstalled(required: { actorId: string; pluginId: string }): void;
}, { id: string }>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/plugins/install',
  parse: raw => ok({ value: { body: raw.body, query: raw.query } }),
  handle: async ({ input, deps, context, authorize }) => ok({ value: await handleInstall({ raw: input, route: { zip: false, preview: false }, deps: { ...deps, readZipUpload: undefined }, context, authorize }) }),
});
export const zipPluginInstallPreviewRoute = {
  method: 'post' as const, path: '/api/admin/v1/workspaces/:workspaceId/plugins/install/zip/preview',
  async handle({ raw, deps, context, authorize }: {
    raw: RouteInputContext; context?: { id: string } | undefined; authorize?: JsonRouteAuthorize | undefined;
    deps: { installer(required: Record<string, never>): PluginInstallerPort | undefined; readZipUpload: NonNullable<Parameters<typeof readInstallInput>[0]['readZipUpload']> };
  }, _optional = {}): Promise<Response> {
    const reply = await handleInstall({ raw, route: { zip: true, preview: true }, deps: { ...deps, onInstalled: undefined }, context, authorize });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  },
};
export const zipPluginInstallRoute = {
  method: 'post' as const, path: '/api/admin/v1/workspaces/:workspaceId/plugins/install/zip',
  async handle({ raw, deps, context, authorize }: {
    raw: RouteInputContext; context?: { id: string } | undefined; authorize?: JsonRouteAuthorize | undefined;
    deps: { installer(required: Record<string, never>): PluginInstallerPort | undefined; readZipUpload: NonNullable<Parameters<typeof readInstallInput>[0]['readZipUpload']>; onInstalled(required: { actorId: string; pluginId: string }): void };
  }, _optional = {}): Promise<Response> {
    const reply = await handleInstall({ raw, route: { zip: true, preview: false }, deps, context, authorize });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  },
};

export async function readZipUpload({ deps }: { deps: {
  isZip: () => boolean;
  parseZip: () => Promise<unknown>;
  body: () => unknown;
  isBuffer: (value: unknown) => value is Uint8Array;
  uploadLimitText: string;
} }, _optional = {}): Promise<{ ok: true; archive: Uint8Array } | { ok: false; refusal: InstallRefusal }> {
  if (!deps.isZip()) return { ok: false, refusal: { status: 400, code: "PLUGIN_INSTALL_INPUT_INVALID", error: "An application/zip upload is required." } };
  const parseError = await deps.parseZip();
  if (parseError) return { ok: false, refusal: zipParserRefusal({ error: parseError, uploadLimitText: deps.uploadLimitText }) };
  if (!deps.isBuffer(deps.body())) return { ok: false, refusal: zipParserRefusal({ error: undefined, uploadLimitText: deps.uploadLimitText }) };
  return { ok: true, archive: deps.body() as Uint8Array };
}

export function respondInstallFailure({ error, deps }: { error: unknown; deps: {
  installError: abstract new (...args: never[]) => Error & { code: string };
  json: (body: unknown, status: number) => void;
  failure: (error: unknown) => void;
} }, _optional = {}): void {
  if (error instanceof deps.installError) { deps.json({ code: error.code, error: error.message }, pluginInstallErrorStatus({ code: error.code })); return; }
  deps.failure(error);
}

/** Local sources are explicitly opt-in, even for admins. ZIP parsing follows authorization. */
export function registerPluginInstallRoutes<Parser>(required: {
  mountJson<Input, Output, Deps>(required: {
    spec: JsonRouteSpec<Input, Output, Deps, { id: string }>;
    deps: Deps;
    failure: (facts: { error: unknown; principalId: () => string; json: (body: unknown, status: number) => void; incident: (error: unknown, options: { operation: string; code: string }) => void }) => void;
  }): void;
  parserFactory(required: { type: "application/zip"; limit: number; inflate: false }): Parser;
  mountRaw<Deps>(required: {
    spec: { method: 'post'; path: string; handle(required: { raw: RouteInputContext; deps: Deps; context?: { id: string } | undefined; authorize?: JsonRouteAuthorize | undefined }, _optional?: Record<string, never>): Promise<Response> };
    requestDeps: (facts: Omit<Parameters<typeof readZipUpload>[0]["deps"], "uploadLimitText" | "parseZip"> & { parseZip(parser: Parser): Promise<unknown> }) => Deps;
    failure: Parameters<Parameters<typeof registerPluginInstallRoutes>[0]["mountJson"]>[0]["failure"];
  }): void;
  installer: Parameters<typeof folderPluginInstallRoute.handle>[0]["deps"]["installer"];
  onInstalled: Parameters<typeof folderPluginInstallRoute.handle>[0]["deps"]["onInstalled"];
  onFailure: (required: { actorId: string; reasonClass: "refused" | "internal" }) => void;
  installError: Parameters<typeof respondInstallFailure>[0]["deps"]["installError"];
  operation: string; maxArchiveBytes: number; uploadLimitText: string;
}, _optional = {}): void {
  const parser = required.parserFactory({ type: "application/zip", limit: required.maxArchiveBytes, inflate: false });
  const matrix = [[folderPluginInstallPreviewRoute, false, true], [folderPluginInstallRoute, false, false], [zipPluginInstallPreviewRoute, true, true], [zipPluginInstallRoute, true, false]] as const;
  for (const [spec, zip, preview] of matrix) {
    const failureWriter: Parameters<Parameters<typeof registerPluginInstallRoutes>[0]["mountJson"]>[0]["failure"] = facts => {
      if (!preview) required.onFailure({ actorId: facts.principalId(), reasonClass: facts.error instanceof required.installError ? "refused" : "internal" });
      respondInstallFailure({ error: facts.error, deps: { installError: required.installError, json: facts.json, failure: error => facts.incident(error, { operation: required.operation, code: "INTERNAL_ERROR" }) } });
    };
    if (zip) {
      required.mountRaw<Parameters<typeof zipPluginInstallRoute.handle>[0]["deps"]>({ spec,
        requestDeps: facts => ({ installer: required.installer, onInstalled: required.onInstalled, readZipUpload: () => readZipUpload({ deps: { ...facts, parseZip: () => facts.parseZip(parser), uploadLimitText: required.uploadLimitText } }) }),
        failure: failureWriter,
      });
    } else {
      required.mountJson({ spec, deps: { installer: required.installer, onInstalled: required.onInstalled }, failure: failureWriter });
    }
  }
}
