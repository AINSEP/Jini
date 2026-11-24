import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { PluginActivationRepoPort } from "@jini-ai/core/contracts/site/plugins-host";

import { authorizePlugins, pluginIdParam, requireDiscovered, type PluginErrorClass, type PluginRouteRecord, type PluginsRoutePrincipal } from "./shared.js";

/** A plugin hook failure: the engine's error carries the failing plugin's id. */
export type PluginHookFailure = Error & { readonly pluginId: string };

/** The unsaved entry one plugin's `beforeSave` filter runs on. */
export interface PluginPreviewEntry {
  id: string; workspaceId: string; title: string; metaDescription?: string; slug: string;
  status: "draft"; bodyJson: Readonly<Record<string, unknown>>; ext: Record<string, never>;
}

/** The deps both preview routes read (methods, so a host may bind ones typed against its own types). */
export interface PluginPreviewRouteDeps {
  workspaceId: string;
  pluginActivationRepo: Pick<PluginActivationRepoPort, "getActivation">;
  discoverPlugins(): Promise<readonly PluginRouteRecord[]>;
  /** One plugin's `beforeSave` on a draft, never counted toward quarantine; `null` when it is not enabled. */
  previewPluginBeforeSave(pluginId: string, entry: PluginPreviewEntry): Promise<unknown>;
  hookFailedError: PluginErrorClass<PluginHookFailure>;
  /** The host's `PLUGIN_HOOK_FAILED` envelope (it logs the plugin's own error; the body names none of it). */
  pluginHookFailedBody(err: PluginHookFailure, optional?: { publicText?: string }): object;
}

/** One previewable draft, as the admin editor sends it. */
interface PreviewDraft { readonly postId?: string; readonly title: string; readonly metaDescription?: string; readonly slug?: string; readonly bodyJson: Readonly<Record<string, unknown>> }

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const areOptionalStrings = ({ values }: { values: unknown[] }, _optional = {}): boolean => values.every((value) => value === undefined || typeof value === "string");

/** The body's draft, including the editor's unsaved meta description, or `null` when invalid. @complexity O(1). */
function parsePreviewDraft({ body }: { body: unknown }, _optional = {}): PreviewDraft | null {
  if (!isPlainObject(body)) return null;
  const { postId, title, slug, bodyJson, metaDescription } = body;
  if (typeof title !== "string" || !isPlainObject(bodyJson)) return null;
  if (!areOptionalStrings({ values: [postId, slug, metaDescription] })) return null;
  return {
    title, bodyJson,
    ...(metaDescription === undefined ? {} : { metaDescription: metaDescription as string }),
    ...(postId === undefined ? {} : { postId: postId as string }),
    ...(slug === undefined ? {} : { slug: slug as string }),
  };
}

/** A hook failure is the plugin's (422, the draft could not be processed), in the save routes'
 *  `PLUGIN_HOOK_FAILED` envelope with fixed preview text — never the plugin's own error; anything
 *  else is rethrown for the host's redacted 500. @complexity O(1). */
function rejectPreviewError({ err, deps }: { err: unknown; deps: PluginPreviewRouteDeps }, _optional = {}): never {
  if (!(err instanceof deps.hookFailedError)) throw err;
  const body = deps.pluginHookFailedBody(err, { publicText: `a site plugin (${err.pluginId}) failed on this draft; nothing was saved` });
  throw new RouteRefusalError({ status: 422, body });
}

const PATH = "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/preview";

/**
 * `PLUGIN_PREVIEW_STATUS` — answers `{ pluginId, enabled }` under the `content.write` gate, so the
 * editor can decide whether to show "Analyze now" without the admin plugin list (`admin.plugins.read`,
 * which a built-in editor lacks). `enabled` is the activation row's, exactly as `PLUGINS_LIST` projects it.
 */
export const pluginPreviewStatusRoute = defineJsonRoute<{ pluginId: string }, { pluginId: string; enabled: boolean }, PluginPreviewRouteDeps, PluginsRoutePrincipal>({
  method: "get",
  path: PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePlugins({ authorize, permission: "content.write" });
    try {
      requireDiscovered({ records: await deps.discoverPlugins(), pluginId: input.pluginId });
      const activation = await deps.pluginActivationRepo.getActivation({ workspaceId: deps.workspaceId, pluginId: input.pluginId });
      return ok({ value: { pluginId: input.pluginId, enabled: activation?.enabled ?? false } });
    } catch (err) {
      return rejectPreviewError({ err, deps });
    }
  },
});

/** The entry the filter runs on: an unsaved draft, so an absent id/slug get fixed placeholders. @complexity O(1). */
function previewEntry({ draft, workspaceId }: { draft: PreviewDraft; workspaceId: string }, _optional = {}): PluginPreviewEntry {
  return {
    id: draft.postId ?? "preview", workspaceId, title: draft.title,
    ...(draft.metaDescription === undefined ? {} : { metaDescription: draft.metaDescription }),
    slug: draft.slug ?? "", status: "draft", bodyJson: draft.bodyJson, ext: {},
  };
}

/**
 * `PLUGIN_PREVIEW` — runs ONE enabled plugin's `content.entry.beforeSave` filter on a draft and
 * returns that plugin's validated fields, without saving anything (the post editor's "Analyze now").
 * Gated on `content.write`, the permission editing a post needs. The body is validated AFTER that
 * gate (the hand-written order: a caller without it gets 403, not 400), and the id is looked up
 * after both, so a caller without the permission learns nothing about which plugin ids exist.
 */
export const pluginPreviewRunRoute = defineJsonRoute<{ pluginId: string; body: unknown }, { pluginId: string; fields: unknown }, PluginPreviewRouteDeps, PluginsRoutePrincipal>({
  method: "post",
  path: PATH,
  parse: (raw) => ok({ value: { pluginId: pluginIdParam({ params: raw.params }), body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePlugins({ authorize, permission: "content.write" });
    try {
      const draft = parsePreviewDraft({ body: input.body });
      if (!draft) rejectRoute({ status: 400, error: "title (string) and bodyJson (object) are required; postId, slug and metaDescription must be strings", code: "VALIDATION_ERROR" });
      requireDiscovered({ records: await deps.discoverPlugins(), pluginId: input.pluginId });
      const fields = await deps.previewPluginBeforeSave(input.pluginId, previewEntry({ draft, workspaceId: deps.workspaceId }));
      if (fields === null) rejectRoute({ status: 409, error: "plugin is not enabled", code: "PLUGIN_NOT_ENABLED" });
      return ok({ value: { pluginId: input.pluginId, fields } });
    } catch (err) {
      return rejectPreviewError({ err, deps });
    }
  },
});
