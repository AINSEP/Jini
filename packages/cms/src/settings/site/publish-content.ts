import type { JsonValue } from "@jini-ai/core/primitives";
import {
  DefinitionNotFoundError,
  DefinitionTombstonedError,
  ForbiddenError,
  resolveDefinitionRaw,
  SCOPE_BIT,
  ScopeNotAllowedError,
  SecretNotSupportedError,
  ValueValidationFailedError,
  type SetValueRequired,
  type SettingDefinitionRecord,
  type SettingsPrincipalLookupPort,
  type SettingsRepoPort,
} from "@jini-ai/core/settings";

import { PublishContentApplyRowError } from "../../publish/transfer/apply-errors.js";
import type { PackedEntity } from "../../publish/transfer/packed-entity.js";
import { clear, set, type SiteSettingsWritePolicies } from "./site-title-write.js";

/**
 * @file `site-setting` on the host's repo-backed publish factory (injected as
 * `createRepoPublishHandler`): the owner-authored site identity — title and SEO defaults — travels to
 * the live site (plan §1, OQ1 = yes).
 *
 * Settings are a security boundary, so this is an ALLOWLIST (the host's injected `publishableSettings`),
 * never a denylist: plenty of non-secret settings are per-environment (BYOK/provider chips, `site.testing`,
 * analytics IP ranges, privacy installation ids). A key must be listed AND its definition must be
 * non-secret and allow workspace scope, checked on the sending side (pack) and again on the receiving
 * side (precheck and write), so a hand-made bundle naming any other key is refused.
 *
 * Deliberately left out, though owner-authored: the crawl controls (`site.seo`
 * `default_robots_noindex`/`default_robots_nofollow`/`robots_rules`/`sitemap_enabled`) — a local or
 * staging value would deindex the live site; `site.comments.*` and `site.assistant.public_enabled`
 * are site behaviour, not identity. Only workspace values travel; a user's own preference never does.
 *
 * Addressed by `namespace:key`. Version is the value row's `seq` (the ledger revision that wrote it);
 * `set` records a `setting_revisions` row like any admin edit. A key cleared on the source (its
 * workspace row is `state='cleared'`) packs as `{ value: null, cleared: true }` and the destination
 * clears its own through `clear`, which records the revision too. A key never set on the source packs
 * nothing, so a fresh install never wipes the live site's values. `cleared` is left out of a set
 * row's state, so every hash packed before it existed stays the same.
 *
 * ## Wiring
 *
 * The host binds, once at its publish-content manifest: its factory (`createRepoPublishHandler`), its
 * command-gateway accessor (`gatewayDeps`, whose `authorize` checks the write), its allowlist
 * (`publishableSettings`, key → label), its dedicated settings writers (`writePolicies`) and its
 * principal lookup (`principalLookup`).
 */

const OG_IMAGE = "site.seo:default_og_image";

export interface SiteSettingRow {
  readonly key: string;
  readonly label: string;
  readonly value: JsonValue | null;
  /** Only on a cleared workspace row; absent (not `false`) on a set one. */
  readonly cleared?: true;
  readonly version: number;
}

/** The host's `site-setting` publish ports: the settings ledger and its principal repository. */
export interface SiteSettingPublishPorts<TPrincipals> {
  readonly settings: SettingsRepoPort;
  readonly principals: TPrincipals;
}

/** The slice of the host's publish deps this config reads. */
export interface SiteSettingPublishDeps<TPrincipals> {
  readonly ports: { readonly "site-setting": SiteSettingPublishPorts<TPrincipals> };
  readonly clock: SetValueRequired["deps"]["clock"];
  readonly idGen: SetValueRequired["deps"]["ids"];
}

/** `"transferred"` is packed and hashed; `"provenance"` is packed but not hashed; `"local"` never leaves the row. */
type FieldDisposition = "transferred" | "provenance" | "local";

/** A domain error class the host factory maps to a `blocked` row outcome. */
type ErrorClass = abstract new (...args: never[]) => Error;

type Ports<TPrincipals> = SiteSettingPublishPorts<TPrincipals>;

/** The repo-backed publish-handler config this contribution fills (the slice of the host's config type it uses). */
export interface SiteSettingRepoPublishConfig<TPrincipals, TDeps extends SiteSettingPublishDeps<TPrincipals>> {
  readonly entityType: string;
  readonly coversTables: readonly string[];
  readonly permission: string;
  readonly dependsOn: readonly string[];
  readonly ports: (required: { deps: TDeps }, optional?: Record<string, never>) => Ports<TPrincipals>;
  readonly list: (required: { ports: Ports<TPrincipals>; workspaceId: string }, optional?: Record<string, never>) => Promise<readonly SiteSettingRow[]>;
  readonly find: (required: { ports: Ports<TPrincipals>; workspaceId: string; id: string }, optional?: Record<string, never>) => Promise<SiteSettingRow | null>;
  readonly idOf: (required: { row: SiteSettingRow }, optional?: Record<string, never>) => string;
  readonly include: (required: { row: SiteSettingRow }, optional?: Record<string, never>) => boolean;
  readonly fields: Record<Extract<keyof SiteSettingRow, string>, FieldDisposition>;
  readonly omitWhenAbsent: readonly string[];
  readonly references: (required: { entity: PackedEntity }, optional?: Record<string, never>) => readonly { entityType: string; key: string }[];
  readonly validate: (input: { ports: Ports<TPrincipals>; workspaceId: string; entity: PackedEntity }, optional?: {}) => Promise<string | null>;
  readonly write: (
    ctx: { ports: Ports<TPrincipals>; deps: TDeps; workspaceId: string; id: string; state: Record<string, unknown>; principalId: string },
    optional?: {},
  ) => Promise<{ version: number }>;
  readonly errors: { readonly blocked: readonly ErrorClass[] };
}

/** What the host binds once for this contribution. */
export interface SiteSettingPublishHost<TPrincipals, TDeps extends SiteSettingPublishDeps<TPrincipals>, TContributor> {
  /** The host's repo-backed publish-handler factory, narrowed to this config; returns the host's contributor. */
  readonly createRepoPublishHandler: (config: SiteSettingRepoPublishConfig<TPrincipals, TDeps>, optional?: {}) => TContributor;
  /** The host's command-gateway accessor; only its `authorize` reaches the settings write. */
  readonly gatewayDeps: (required: { deps: TDeps; entityType: string }, optional?: {}) => { readonly authorize: SetValueRequired["deps"]["authorize"] };
  /** The allowlist: `namespace:key` → the label an operator reads. */
  readonly publishableSettings: Readonly<Record<string, string>>;
  /** The host's dedicated settings writers, passed to the package write chokepoint. */
  readonly writePolicies: SiteSettingsWritePolicies;
  /** Builds the settings principal lookup over the host's principal repository. */
  readonly principalLookup: (required: { repo: TPrincipals }) => SettingsPrincipalLookupPort;
}

/** Loopback, private-range and `.local` hosts: a URL naming one only works on this computer. */
const LOCAL_HOSTS = [
  /^(?:localhost|.*\.localhost|.*\.local|0\.0\.0\.0|\[::1?\])$/i,
  /^(?:127|10)(?:\.\d+){3}$/,
  /^(?:192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/,
];

/** An absolute URL whose host is this computer or its private network. A media ref (`<id>:<transform>`)
 *  or a public URL is fine. @complexity O(n) in the value's length. */
export function pointsAtThisComputer({ value }: { value: unknown }, _optional = {}): boolean {
  if (typeof value !== "string" || !/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())) return false;
  try {
    const hostname = new URL(value.trim()).hostname;
    return LOCAL_HOSTS.some(pattern => pattern.test(hostname));
  } catch {
    return true;
  }
}

function splitKey({ id }: { id: string }, _optional = {}): { namespace: string; key: string } {
  const at = id.indexOf(":");
  return { namespace: id.slice(0, at), key: id.slice(at + 1) };
}

/** The definition, when `id` is allowlisted and it is non-secret, active and workspace-scoped. */
async function publishableDefinition(
  { ports, workspaceId, id, publishableSettings }: { ports: { settings: SettingsRepoPort }; workspaceId: string; id: string; publishableSettings: Readonly<Record<string, string>> },
  _optional = {}
): Promise<SettingDefinitionRecord | null> {
  if (!Object.hasOwn(publishableSettings, id)) return null;
  const definition = await resolveDefinitionRaw({ repo: ports.settings }, { ...splitKey({ id }), workspaceId });
  const ok = definition && definition.status === "active" && !definition.secret && (definition.scopes & SCOPE_BIT.workspace) !== 0;
  return ok ? definition : null;
}

/** The workspace row, set or cleared; `null` when the key was never written here.
 *  @complexity two indexed reads. */
async function findSetting(
  { ports, workspaceId, id, publishableSettings }: { ports: { settings: SettingsRepoPort }; workspaceId: string; id: string; publishableSettings: Readonly<Record<string, string>> },
  _optional: Record<string, never> = {},
): Promise<SiteSettingRow | null> {
  const definition = await publishableDefinition({ ports, workspaceId, id, publishableSettings });
  if (!definition) return null;
  const row = await ports.settings.getWorkspaceValue({ workspaceId, settingId: definition.settingId });
  if (!row) return null;
  const label = publishableSettings[id];
  if (label === undefined) throw new Error(`Publishable setting ${id} has no label`);
  return row.state === "cleared" ? { key: id, label, value: null, cleared: true, version: row.seq } : { key: id, label, value: row.valueJson, version: row.seq };
}

/** Plain refusals, rewritten for the owner by the host's publish report rows. */
const notPublishable = ({ id }: { id: string }, _optional = {}) => `site-setting '${id}' is not one this site publishes`;
const localOnly = ({ id }: { id: string }, _optional = {}) => `site-setting '${id}' points at this computer`;

/** The `site-setting` publish contribution, built on the host's injected factory and bindings.
 *  @complexity O(k) per list over the allowlist; two indexed reads per key.
 *  @example contributeSiteSettingPublish({ createRepoPublishHandler, gatewayDeps, publishableSettings, writePolicies, principalLookup });
 */
export function contributeSiteSettingPublish<TPrincipals, TDeps extends SiteSettingPublishDeps<TPrincipals>, TContributor>(
  host: SiteSettingPublishHost<TPrincipals, TDeps, TContributor>,
  _optional: Record<string, never> = {},
): TContributor {
  const { publishableSettings, writePolicies } = host;
  return host.createRepoPublishHandler({
    entityType: "site-setting",
    coversTables: ["setting_values_workspace"],
    // What `deriveRequiredPermission` names for a workspace-scope `set`.
    permission: "settings.workspace.write",
    // The share image may name a media item.
    dependsOn: ["media"],
    ports: ({ deps }, _optional = {}) => deps.ports["site-setting"],
    list: async ({ ports: p, workspaceId }) => {
      const rows = await Promise.all(Object.keys(publishableSettings).map((id) => findSetting({ ports: p, workspaceId, id, publishableSettings })));
      return rows.filter((row): row is SiteSettingRow => row !== null);
    },
    find: ({ ports, workspaceId, id }) => findSetting({ ports, workspaceId, id, publishableSettings }),
    idOf: ({ row }, _optional = {}) => row.key,
    include: ({ row }, _optional = {}) => !(row.key === OG_IMAGE && pointsAtThisComputer({ value: row.value })),
    fields: { key: "local", label: "provenance", value: "transferred", cleared: "transferred", version: "local" },
    omitWhenAbsent: ["cleared"],
    references: ({ entity }) => {
      // `<media id>:<transform>`; a slug or URL names nothing a scoped publish can carry.
      const ref = entity.id === OG_IMAGE ? entity.state.value : null;
      const mediaId = typeof ref === "string" ? ref.split(":")[0] : "";
      return mediaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId) ? [{ entityType: "media", key: mediaId }] : [];
    },
    validate: async ({ ports, workspaceId, entity }) => {
      if (!(await publishableDefinition({ ports, workspaceId, id: entity.id, publishableSettings }))) return notPublishable({ id: entity.id });
      return entity.id === OG_IMAGE && pointsAtThisComputer({ value: entity.state.value }) ? localOnly({ id: entity.id }) : null;
    },
    write: async ({ ports, deps, workspaceId, id, state, principalId }) => {
      // Precheck already refused these; checked again because this is the one write.
      if (!(await publishableDefinition({ ports, workspaceId, id, publishableSettings }))) throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: notPublishable({ id }) });
      if (id === OG_IMAGE && pointsAtThisComputer({ value: state.value })) throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: localOnly({ id }) });
      const { authorize } = host.gatewayDeps({ deps, entityType: "site-setting" });
      const writeDeps = { repo: ports.settings, clock: deps.clock, ids: deps.idGen, authorize, principals: host.principalLookup({ repo: ports.principals }) };
      const target = { ...splitKey({ id }), scope: "workspace" as const, workspaceId, callerPrincipalId: principalId, authWorkspaceId: workspaceId };
      const { revisionSeq } =
        state.cleared === true
          ? await clear({ deps: writeDeps, input: target, writePolicies })
          : await set({ deps: writeDeps, input: { ...target, value: (state.value ?? null) as JsonValue }, writePolicies });
      return { version: revisionSeq };
    },
    errors: {
      blocked: [ValueValidationFailedError, ForbiddenError, DefinitionNotFoundError, DefinitionTombstonedError, ScopeNotAllowedError, SecretNotSupportedError],
    },
  });
}
