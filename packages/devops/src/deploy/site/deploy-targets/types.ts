import type { FormDestinationForm, FormSubmissionsInspection } from "@jini-ai/core/contracts/site/cms-forms";
import type { DeployTargetInspection as PluginDeployTargetInspection, DeployTargetRegistry as PluginDeployTargetRegistry, LoadedDeployTarget as PluginLoadedDeployTarget, PluginDeployTargetModule } from "../../index.js";

/**
 * @file The host contract a deploy-target MODULE (shipped inside an Agent Plugin) is written against.
 *
 * Owner decision 2026-09-29: vendor host code lives in the host's `deploy` agent plugin, and
 * `@jini-ai/devops` keeps only the generic port. Hosts are dependency-injected: this app loads a
 * plugin's module (`registry.ts`), hands it a {@link DeployHostKit}, and gets back a plain devops
 * `DeployTarget`. Nothing in this file names a vendor.
 *
 * The injection contract itself (the kit, the credential, the create/check contexts, the response
 * header set) comes from `@jini-ai/devops/deploy` since 0.4.0, and so do the module extras
 * ({@link DeployTargetModule}'s `summarize`/`hostingSetup`) and the plugin descriptor shapes. Only
 * the form types the preview passes are bound here. The installed plugin ABI remains positional;
 * the host kit adapts its helper calls to devops' object APIs so content-addressed installed
 * packages need no rewrite when the library is rebuilt.
 */

export type {
  DeployCredentialCheck,
  DeployFetchTimeouts,
  ResponseHeaderSet,
  SigV4ClientOptions,
} from "../../index.js";

/** The installed plugin ABI and descriptor shapes live in `@jini-ai/devops/deploy`; the colliding
 *  ABI names carry a `Plugin` prefix there and keep their host names here. */
export type {
  PluginSigV4Client as SigV4Client,
  PluginDeployTargetCreateContext as DeployTargetCreateContext,
  PluginDeployCredentialCheckContext as DeployCredentialCheckContext,
  HostDeployPublishInput,
  HostDeployTarget,
  DeployHostingSetup,
  DeployTargetDescriptor,
  DeployTargetCredentialSpec,
  DeployTargetProjectNameCopy,
  DeployTargetFieldSpec,
  DeployTargetEnvFallback,
  InstalledDeployTarget,
  InstalledDeployTargetInventory,
  LoadInstalledDeployTargets,
} from "../../index.js";

/** This host binds the preview's form types to its own form-destination model. */
export type DeployTargetModule = PluginDeployTargetModule<FormDestinationForm, FormSubmissionsInspection>;
export type DeployTargetInspection = PluginDeployTargetInspection<FormSubmissionsInspection>;
export type LoadedDeployTarget = PluginLoadedDeployTarget<FormDestinationForm, FormSubmissionsInspection>;
export type DeployTargetRegistry = PluginDeployTargetRegistry<FormDestinationForm, FormSubmissionsInspection>;
