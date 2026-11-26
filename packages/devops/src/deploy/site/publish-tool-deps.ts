import type { AgentToolDefinition, ToolHandler, ToolRegistration, ToolExecutionContext, ToolExecutionOptions, HumanConfirmer } from '@jini-ai/core';
import type { requireToolPermission } from '@jini-ai/core';
import type { resolveOperatorLocale } from '@jini-ai/core/operator-locale';
import type { GatedMutationHooks, plan, confirm, execute } from '@jini-ai/core/gated-mutations';
import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { SurfaceCardsPort, SurfaceCardSecretDeps, SurfaceCardSecretOptions, SecretCardForm, SurfaceOutcomeSpec } from '@jini-ai/core/contracts/cards';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { ToolFailureDiagnostic } from '@jini-ai/core/contracts/site/daemon-tool-recovery';
import type { CredentialTokenHint } from '@jini-ai/core/contracts/site/secrets-credential-token';
import type { UIResource } from '@jini-ai/core/contracts/site/protocol-mcp-ui';
import type { LoadInstalledDeployTargets } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { GatewayDeps } from '@jini-ai/core/gated-mutations';
import type { OperatorLocaleDeps } from '@jini-ai/core/contracts/headless/plugin-host';
import type { Clock } from "@jini-ai/core/primitives";
import type { ExportReport as BaseExportReport } from '../../static-export/contracts.js';
type ExportReport = BaseExportReport & { consentWarning?: string };
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";
import type { PublishExecutionMode } from "@jini-ai/devops/deploy/site/publish-credentials/execution-mode";
import type { PublishCredentialWriteDeps, PublishCredentialReadDeps } from './publish-credentials/store.js';
type VendorCredentialSetRepoPort = PublishCredentialReadDeps['repo'];
import type { DeployTargetRegistry } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { PublishCredentialVerificationCache, VerifyPublishCredentialDeps } from './static-publish/verify.js';
import type { PublishHistoryStore } from './static-publish/publish-history.js';
import type { StaticPublishDeps } from './static-publish/adapter.js';
import type { DbPublishCredentialSourceDeps } from './static-publish/credentials.js';
import type { PublishCredentialSource } from "@jini-ai/devops/deploy/site/static-publish/types";



/** Composition-root-bound export operation, typed locally to avoid cross-feature type coupling.
 * The composition root closes over full application dependencies; this feature passes only options.
 */
type ExportSiteBoundFn = (options: { outputDir: string; clean?: boolean; basePath?: string }) => Promise<ExportReport>;


/** Only ports the tool handlers read, declared structurally without importing RouteDeps.
 * A real publish needs the full application graph for export; exportSiteBound captures it at the
 * composition root, so that requirement does not widen this feature's dependency contract.
 * Every other field is a direct port type, never indexed from the composition root's wide bag.
 */
export interface StaticPublishToolDeps extends OperatorLocaleDeps {
  readonly catalog: readonly AgentToolDefinition[];
  readonly env: NodeJS.ProcessEnv;
  readonly staticPublishPorts: Pick<StaticPublishDeps, 'publishJobs' | 'redactSecretShapes' | 'createNoopTracker' | 'createDeployHostKit' | 'defaultPublicPageSecurityHeaders' | 'firstExportFailure' | 'rmSync' | 'warn' | 'rewriteFormActions' | 'issueCredentialSetup'>;
  readonly credentialStorePorts: Omit<PublishCredentialWriteDeps, 'repo' | 'sealer' | 'keyring' | 'clock' | 'idGen' | 'loadDeployTargets' | 'allowSharedKeyReplacement'>;
  readonly credentialSourceStorePorts: Pick<DbPublishCredentialSourceDeps, 'describeCredential' | 'hasDefaultForPublish' | 'resolveForPublish' | 'resolveDefaultForPublish'>;
  readonly verificationPorts: Pick<VerifyPublishCredentialDeps, 'assertCredentialToken' | 'CredentialInputError' | 'credentialText' | 'createDeployHostKit'>;
  readonly requireToolPermission: typeof requireToolPermission;
  readonly resolveOperatorLocale: typeof resolveOperatorLocale;
  readonly gatewayPlan: typeof plan;
  readonly gatewayConfirm: typeof confirm;
  readonly gatewayExecute: typeof execute;
  readonly resolveActorClassIdentity: GatedMutationHooks<unknown, unknown>['resolveActorClassIdentity'];
  readonly planHashOf: (required: { details: unknown }) => string;
  readonly checkToolPublishConsent: (required: { deps: StaticPublishToolDeps; principalId: string }) => Promise<Record<string, unknown> | null>;
  readonly defineSecretCardTool: SurfaceCardsPort['defineSecretCardTool'];
  readonly buildOutcomeSurface: SurfaceCardsPort<UIResource>['buildOutcomeSurface'];
  readonly askThenReport: SurfaceCardSecretDeps['askThenReport'];
  readonly secretCardOptions: SurfaceCardSecretOptions;
  readonly uriHost: string;
  readonly publishOutcomeApp: SurfaceOutcomeSpec['app'];
  readonly credentialFormApp: SecretCardForm['app'];
  readonly credentialRowLabel: string;
  readonly credentialSaveToolId: string;
  readonly abortGuardedCredentialRepo: <T extends { readonly vault?: import('@jini-ai/core/contracts/vault').VaultRepoPort }>(required: { store: T; signal: AbortSignal }, optional?: Record<string, never>) => T;
  readonly findPluginCredentialCard: (required: { loadCards?: StaticPublishToolDeps['loadPluginCredentialCards'] | undefined; workspaceId: string; saveKind: PluginCredentialCard['saveKind']; target: string }, optional?: Record<string, never>) => Promise<PluginCredentialCard | undefined>;
  readonly applyPluginCredentialCard: (required: { card?: PluginCredentialCard; form: SecretCardForm }) => SecretCardForm;
  readonly assertCredentialFreeField: (required: { value: string; field: string }) => void;
  readonly credentialText: (required: { id: 'saved' | 'connected' | 'auth' | 'timeout' | 'unreachable' | 'blank' | 'savedTitle'; locale?: string }) => string;
  readonly formatCredentialHint: (required: { hint: CredentialTokenHint | null; locale: string }) => string;
  readonly translateCredentialMessage: (required: { message: string; locale: string }) => string;
  readonly issueCredentialSetup: StaticPublishDeps['issueCredentialSetup'];
  readonly toolApprovalConfirmation: (required: { descriptor: Pick<ToolRegistration['descriptor'], 'id' | 'metadata' | 'inputSchema'>; input: unknown; locale: string }) => HumanConfirmSpec;
  readonly approvalToolHandler: <TPrepared>(steps: {
    surfaces: AssistantSurfaceDeps;
    prepare(input: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<TPrepared>;
    describe(input: { ctx: ToolExecutionContext; prepared: TPrepared }, optional: ToolExecutionOptions): HumanConfirmSpec | Promise<HumanConfirmSpec>;
    run(input: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer }, optional: ToolExecutionOptions): Promise<unknown>;
  }, optional: { flag: string }) => ToolHandler;
  readonly loadPluginCredentialCards?: (workspaceId: string) => Promise<readonly PluginCredentialCard[]>;
  /** Existing shared gateway; required when publishing with infrastructure changes. */
  readonly gatedMutations?: { readonly gatewayDeps: GatewayDeps };
  readonly hostKit?: StaticPublishDeps["hostKit"];
  readonly publicPageSecurityHeaders?: StaticPublishDeps["publicPageSecurityHeaders"];
  readonly pluginExportHosts?: StaticPublishDeps["pluginExportHosts"];
  /** `RouteDeps.formDestination`: the site's forms and receiver key, for a host that receives submissions. */
  readonly formDestination?: StaticPublishDeps["formDestination"];
  readonly ownerPrincipalId?: Promise<string>;
  readonly authorize: AuthorizeFn;
  readonly workspaceId: string;
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  readonly siteAssistantSecretSealer: SecretSealerPort;
  readonly siteAssistantSecretKeyring: KeyringPort;
  readonly publishExecutionMode: PublishExecutionMode;
  readonly publishHistoryStore: PublishHistoryStore;
  readonly publishCredentialVerificationCache: PublishCredentialVerificationCache;
  readonly vendorCredentialSetRepo: VendorCredentialSetRepoPort;
  /** `RouteDeps.publishOutputRootDir`, threaded down for the same reason `exportSiteBound` above is —
   *  `publishStaticSite`'s `StaticPublishInput.publishOutputRootDir` needs it directly. */
  readonly publishOutputRootDir: string;
  /** The pre-bound export call — see {@link ExportSiteBoundFn}'s own doc above for what it is and why
   *  it replaces the `routeDeps: RouteDeps` field this interface used to carry (via `extends RouteDeps`). */
  readonly exportSiteBound: ExportSiteBoundFn;
  /** Test-only override — when supplied, replaces the composed `PublishCredentialSource` entirely
   *  (DB-backed + env-fallback composition, `vendorCredentialSetRepo`/`siteAssistantSecretSealer`/
   *  `publishExecutionMode` are all ignored). Production never sets this. */
  credentialSource?: PublishCredentialSource;
  /** Test-only override for `publishStaticSite`'s own `StaticPublishDeps.buildTarget` — lets a test
   *  substitute a fake `DeployTarget` so `deployment_execute_static_publish`'s CONFIRMED path can be
   *  exercised end-to-end without ever constructing a real host plugin's
   *  client or touching `fetch` (mirrors `static-publish/adapter.ts`'s own test-injection seam,
   *  "adapter tests with a faked deploy target — do not hit real providers in tests"). Production
   *  never sets this — `publishStaticSite`'s own default (the real Jini adapters) applies. */
  buildTarget?: StaticPublishDeps["buildTarget"];
  /** `RouteDeps.loadDeployTargets` — this workspace's deploy registry, which decides which config
   *  fields a target takes and judges them. Production composition injects the installed deploy Agent Plugin
   *  (`loadDeployTargetRegistry`); a test injects a registry read from the plugin's source. */
  loadDeployTargets: ({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>) => Promise<DeployTargetRegistry>;
  /** Installed metadata; production binds the data contribution loader, never executable discovery. */
  readonly loadInstalledDeployTargets?: LoadInstalledDeployTargets;
  /** Post-save connection checks share the verifier's HTTP seam; fixtures never need real egress. */
  readonly fetchFn?: typeof fetch;
  /** Test-only override for `RouteDeps.publishHistoryStore` (2026-08-16 rework — that field is now
   *  the real, DB-backed `SqlitePublishHistoryStore` in production; see `routes/types.ts`'s own doc)
   *  — lets a test inject an `InMemoryPublishHistoryStore` so it can assert on a recorded publish (or
   *  a capabilities read) without touching a real database. Passed straight through to
   *  `runPublishAndAwait` on a confirmed publish AND used by the capabilities handler's own read, so a
   *  test sees one consistent store on both sides. Production never sets this; both paths fall back to
   *  `deps.publishHistoryStore`, so a real publish's history is visible to this tool with no wiring
   *  change outside this domain (see `publish-run.ts`'s header, "Publish history"). */
  historyStore?: PublishHistoryStore;
  /** `RouteDeps.observability`, forwarded so a confirmed publish's deploy egress is traced. */
  readonly observability?: ObservabilityPort;
  readonly tracker?: import("@jini-ai/core/contracts/site/diagnostics-observability").Tracker;
}

type OptionalPublishPorts = Pick<StaticPublishDeps, "tracker" | "observability" | "hostKit" | "formDestination" | "publicPageSecurityHeaders" | "pluginExportHosts" | "buildTarget">;

/** The tool deps' optional static-publish ports, each present only when the host supplied it
 * (exact optional properties forbid passing an explicit `undefined`). O(1). */
export function optionalPublishPorts(required: { deps: Pick<StaticPublishToolDeps, keyof OptionalPublishPorts> }, _optional: Record<string, never> = {}): OptionalPublishPorts {
  const { tracker, observability, hostKit, formDestination, publicPageSecurityHeaders, pluginExportHosts, buildTarget } = required.deps;
  return {
    ...(tracker === undefined ? {} : { tracker }),
    ...(observability === undefined ? {} : { observability }),
    ...(hostKit === undefined ? {} : { hostKit }),
    ...(formDestination === undefined ? {} : { formDestination }),
    ...(publicPageSecurityHeaders === undefined ? {} : { publicPageSecurityHeaders }),
    ...(pluginExportHosts === undefined ? {} : { pluginExportHosts }),
    ...(buildTarget === undefined ? {} : { buildTarget }),
  };
}
