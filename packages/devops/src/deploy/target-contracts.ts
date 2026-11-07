import type { DescriptorI18n } from '@jini-ai/core/text';
import type { ArtifactStorePort } from '../core/artifact-store.js';
import type { DeployPublishInput, DeployPublishOptions, DeployTarget, DeployPublishResult, DeployError, UnknownRecord } from '../core/deploy-types.js';
import type { DeployTargetModule as DevopsDeployTargetModule, DeployHostKit as DevopsDeployHostKit, DeployTargetCreateContext as DevopsCreateContext, DeployCredentialCheckContext as DevopsCheckContext, SigV4ClientOptions } from './host-kit.js';

/**
 * @file The contract a deploy-target MODULE shipped inside an Agent Plugin is written against, and
 * the descriptor shapes its `deploy-targets` contribution file declares.
 *
 * Hosts are dependency-injected: a host loads a plugin's module, hands it a
 * {@link PluginDeployHostKit}, and gets back a plain {@link DeployTarget}. The installed plugin ABI
 * stays positional; the host kit adapts its helper calls to this package's object APIs. The form
 * types a host's preview passes through are type parameters, so this package names no form model.
 */

/** Compatibility types for the standalone modules already installed on disk. */
type LegacyReachabilityOptions = Omit<NonNullable<Parameters<DevopsDeployHostKit["checkDeploymentUrl"]>[1]>, "detectProtected"> & {
  detectProtected?: (resp: Response, body: string) => boolean;
};
type LegacyWaitOptions = Omit<NonNullable<Parameters<DevopsDeployHostKit["waitForReachableDeploymentUrl"]>[1]>, "detectProtected"> & LegacyReachabilityOptions;
export interface PluginSigV4Client {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  sign(input: string, init?: RequestInit): Promise<Request>;
}
export interface PluginDeployHostKit {
  /** Optional newer plugin ports; installed older modules keep their existing ABI. */
  now?(): number;
  probeContent?(required: { readonly url: string; readonly expected: string }, optional?: Record<string, never>): Promise<boolean>;
  fetch(url: string, init: RequestInit, options: { readonly timeoutMs: number }): Promise<Response>;
  readonly timeouts: DevopsDeployHostKit["timeouts"];
  sleep(ms: number): Promise<void>;
  checkDeploymentUrl(url: unknown, options?: LegacyReachabilityOptions): ReturnType<DevopsDeployHostKit["checkDeploymentUrl"]>;
  waitForReachableDeploymentUrl(urls: unknown[], options?: LegacyWaitOptions): ReturnType<DevopsDeployHostKit["waitForReachableDeploymentUrl"]>;
  normalizeDeploymentUrl(url: unknown): string;
  safeDnsLabel(raw: unknown): string;
  safeProjectLabel(raw: unknown, maxLength: number): string;
  redirectGuardInit(init: RequestInit): RequestInit;
  assertNotRedirected(resp: Response, providerLabel: string): void;
  createSigV4Client(options: SigV4ClientOptions): PluginSigV4Client;
  readonly DeployError: new (message: string, status?: number, details?: DeployError["details"]) => DeployError;
}
export type PluginDeployTargetCreateContext = Omit<DevopsCreateContext, "kit"> & { readonly kit: PluginDeployHostKit };
export type PluginDeployCredentialCheckContext = Omit<DevopsCheckContext, "kit"> & { readonly kit: PluginDeployHostKit };

/** Installed modules receive publish options, including security headers, in their first object.
 *  The static-publish boundary adapts devops' separate options object to this installed ABI. */
export type HostDeployPublishInput = DeployPublishInput & DeployPublishOptions;

/** The installed plugin ABI; the host adapts its publish and checkReachability methods to the
 *  current devops port. `checkReachability` stays positional (`url`) because every installed,
 *  content-addressed module on disk was written that way; devops' port takes `{ url }`. */
export interface HostDeployTarget extends Omit<DeployTarget, "publish" | "checkReachability"> {
  publish(input: HostDeployPublishInput): Promise<DeployPublishResult>;
  checkReachability(url: string): ReturnType<DeployTarget["checkReachability"]>;
}

/**
 * A deploy-target module's default export: devops' {@link DevopsDeployTargetModule} plus two
 * host-only extras. Only `create` is required; the rest have host defaults (no config errors, no
 * base path, no summary rows, no credential check, no hosting steps).
 */
export interface PluginDeployTargetModule<TForm = unknown, TFormSubmissions = unknown> extends Omit<DevopsDeployTargetModule, "create" | "createArtifactStore" | "validateConfig" | "basePath" | "verifyCredential"> {
  /** Authenticated read-only provider inspection. Never uploads or provisions infrastructure.
   *  `formDestination` lists the site's active forms (no receiver key) so a host whose deployment
   *  carries the selected co-hosted receiver (the "co-hosted receiver add-on",
   *  `features/form-destinations/`) can preview its storage. The publish counterpart is
   *  `metadata.formDestination` (forms plus the receiver key). */
  preview?(required: PluginDeployTargetCreateContext & { readonly projectName: string; readonly formDestination?: { readonly forms: readonly TForm[] } }, optional?: Record<string, never>): Promise<DeployTargetInspection<TFormSubmissions>>;
  readonly defaultForNewDestination?: boolean;
  /** A new capability may require explicit compatibility instead of inheriting an old vendor ID. */
  acceptsCredential?(required: { readonly worksFor: readonly string[] }, optional?: Record<string, never>): boolean;
  readonly defaultCredentialWorksFor?: readonly string[];
  /** Exact remote identity, projected through descriptor-allowlisted history fields. */
  destinationConfig?(required: { readonly providerMetadata?: Readonly<Record<string, unknown>> }, optional?: Record<string, never>): Readonly<Record<string, string>>;
  /** Separate single-object lifecycle; never enters static publish's cleanup manifest. */
  createArtifactStore?(required: PluginDeployTargetCreateContext, optional?: Record<string, never>): ArtifactStorePort;
  create(context: PluginDeployTargetCreateContext): HostDeployTarget;
  validateConfig?(config: UnknownRecord): string | null;
  basePath?(config: UnknownRecord): string | undefined;
  verifyCredential?(context: PluginDeployCredentialCheckContext): ReturnType<NonNullable<DevopsDeployTargetModule["verifyCredential"]>>;
  /** The confirmation/outcome card rows for `config`, when the host reads better than one row per
   *  config field (a repository as `owner/repo`, for example). */
  summarize?(config: UnknownRecord): readonly { readonly label: string; readonly value: string }[];
  /** Steps the person applies in their own host console before the site is reachable (making a
   *  storage bucket public, for example). Pure: no request, no credential. `fields` are the non-secret
   *  credential fields the agent passed. Throws a plain `Error` with a person-facing message for a
   *  missing field. */
  hostingSetup?(input: { readonly fields: Readonly<Record<string, string>> }): DeployHostingSetup;
}

/** Plugin-owned inspection data; opaque vendor facts remain outside Jini's generic port. */
export interface DeployTargetInspection<TFormSubmissions = unknown> {
  readonly resourceName: string;
  readonly targetId: string;
  readonly hostingChanges: readonly Readonly<Record<string, unknown>>[];
  readonly domains?: {
    readonly inventoryStatus: "complete" | "unknown";
    readonly fingerprint?: string;
    readonly message: string;
    readonly errorCode?: string;
    readonly hostnames: readonly Readonly<Record<string, unknown>>[];
    readonly changes: readonly Readonly<Record<string, unknown>>[];
  };
  /** Present when the site has active forms: whether they will be received, and what that changes.
   *  The co-hosted receiver add-on reports it from the host's own preview; core answers it otherwise. */
  readonly formSubmissions?: TFormSubmissions;
}

/** A module's hosting-setup answer, relayed to the person as prose plus copyable `consoleJson`. */
export interface DeployHostingSetup {
  /** Which flavour of the host the steps are for, when the module tells them apart. */
  readonly provider?: string;
  readonly steps: readonly { readonly title: string; readonly description: string; readonly consoleJson?: string }[];
  /** Relayed verbatim when non-empty. */
  readonly warning: string;
}

/** One entry of a plugin's `deploy-targets` contribution file. `id` is byte-identical to the legacy provider
 *  id for existing hosts: sealed credentials and publish history rows are keyed by it. */
export interface DeployTargetDescriptor {
  readonly id: string;
  readonly label: string;
  /** Plugin-relative path of the `.mjs` module. */
  readonly module: string;
  /** Per-publish settings the person supplies (a repository, a team), in display order. Read from a
   *  publish request under the same names; values are strings. Empty when the host needs none. */
  readonly configFields: readonly DeployTargetFieldSpec[];
  /** What the publish form calls the per-publish project name for this host (a commit message, a
   *  site name). Absent: the generic "Project name". */
  readonly projectName?: DeployTargetProjectNameCopy;
  /** The server-environment credential fallback. Absent when the host has none. */
  readonly env?: DeployTargetEnvFallback;
  /** What a saved connection for this host holds. Absent when the host takes no saved credential. */
  readonly credential?: DeployTargetCredentialSpec;
  /** Translations of this target's own person-facing text, keyed by locale then by the English
   *  string (`features/agent-plugins/descriptor-i18n.ts`). Absent: English only. */
  readonly i18n?: DescriptorI18n;
}

/**
 * A host's saved credential: flat string fields, sealed as one JSON object together with its
 * `providerId` (the target id). `tokenField` names the required field that becomes the resolved
 * credential's `token`; every other field is handed to the module under its own name.
 */
export interface DeployTargetCredentialSpec {
  /** The account/company the credential authenticates to (`vendor_credential_sets.vendor_id`). */
  readonly vendorId: string;
  /** The name a credential-check message uses ("GitHub accepted this credential."). Defaults to the
   *  target's `label`. */
  readonly vendorLabel?: string;
  /** The module's `verifyCredential` can return an `accountLabel`, so a saved row without one is
   *  worth re-checking in the background. */
  readonly yieldsAccountLabel?: true;
  /** Shown above the credential form's fields (what to have ready before filling it in). */
  readonly help?: string;
  /** The same guidance written for the person; the admin shows it over {@link help} when present. */
  readonly userHelp?: string;
  /** The host's own page for creating the credential (https), linked from the credential form. */
  readonly tokenPageUrl?: string;
  readonly tokenField: string;
  readonly fields: readonly DeployTargetFieldSpec[];
}

/** What the publish form's project-name field means for one host. */
export interface DeployTargetProjectNameCopy {
  readonly label: string;
  readonly help?: string;
}

/** One named string field a person fills in. */
export interface DeployTargetFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly help?: string;
  /** The help a PERSON sees in the admin form, when it should read differently from `help` (which
   *  the agent sees as the field's hint). Absent = the form shows `help`. */
  readonly userHelp?: string;
  /** Never echoed back once saved (credential fields only). */
  readonly secret?: true;
}

/** Where an env-configured install finds a target's credential: the first set `tokenVars` entry
 *  is the token, and each `fields` entry names the env var that supplies that extra credential field
 *  (all required). */
export interface DeployTargetEnvFallback {
  readonly tokenVars: readonly string[];
  readonly fields?: Readonly<Record<string, string>>;
}

export interface LoadedDeployTarget<TForm = unknown, TFormSubmissions = unknown> {
  readonly descriptor: DeployTargetDescriptor;
  readonly pluginId: string;
  readonly module: PluginDeployTargetModule<TForm, TFormSubmissions>;
}

export interface DeployTargetRegistry<TForm = unknown, TFormSubmissions = unknown> {
  get(targetId: string): LoadedDeployTarget<TForm, TFormSubmissions> | undefined;
  list(): readonly LoadedDeployTarget<TForm, TFormSubmissions>[];
  /** Log-safe, one sentence per plugin or target that was NOT loaded, and why. */
  readonly refusals: readonly string[];
}

/** Installed metadata is independent of activation, credential configuration and executable code. */
export interface InstalledDeployTarget {
  readonly descriptor: DeployTargetDescriptor;
  readonly pluginId: string;
  /** null means the activation record could not be read; never interpret it as consent. */
  readonly enabled: boolean | null;
}
export interface InstalledDeployTargetInventory {
  readonly items: readonly InstalledDeployTarget[];
  readonly refusals: readonly string[];
}
export type LoadInstalledDeployTargets = (
  required: { readonly workspaceId: string }, optional?: Record<string, never>,
) => Promise<InstalledDeployTargetInventory>;
