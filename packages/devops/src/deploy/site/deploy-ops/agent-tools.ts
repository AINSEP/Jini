import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { DeployOpsDescriptor, DeployOpsRegistry } from "@jini-ai/devops/deploy";
type AgentToolDefinition = SharedAgentToolDefinition & { inputSchema: Readonly<Record<string, unknown>> };
/** Data-only source snapshot for hermetic catalog construction; never used to authorize or import modules. */
function bundledDescriptors(read: BundledDescriptorReader, sourceRoot: string): readonly DeployOpsDescriptor[] {
  try {
    return read({ sourceRoot });
  } catch { return []; }
}
/** Reads the bundled deploy-ops descriptors from a plugin source root (injectable for tests). */
export type BundledDescriptorReader = (input: { sourceRoot: string }) => readonly DeployOpsDescriptor[];
const platformList = (platforms: readonly DeployOpsDescriptor[]) => {
  const labels = platforms.map(p => `${p.id} (${p.label})`).join(", ");
  return ` Platforms: ${labels || "none available; enable a hosting plugin under Agent Plugins"}.`;
};
/** Build schemas from the loaded registry. O(platforms + eight tools); a missing registry uses bundled data only. */
export function getDeployOpsAgentToolCatalog(required: {
  registry?: DeployOpsRegistry; sourceRoot: string; readBundledDescriptors: BundledDescriptorReader;
  maxWaitSeconds: number; readPermission: string; writePermission: string;
  secretNameDescription: string; unsetSecretDescription: string;
}, _optional = {}): AgentToolDefinition[] {
  const { registry, maxWaitSeconds: MAX_WAIT_SECONDS } = required;
  const platforms = registry ? registry.list().map(p => p.descriptor) : bundledDescriptors(required.readBundledDescriptors, required.sourceRoot);
  const ids = platforms.map(p => p.id);
  const listed = platformList(platforms);
  // Secrets are an optional adapter verb set, so their tools advertise only adapters that export it
  // (github-actions has none). Bundled data cannot say which do; the handler refuses the rest.
  const secrets = registry ? registry.list().filter(p => typeof p.module.listSecrets === "function").map(p => p.descriptor) : platforms;
  const secretsListed = registry ? platformList(secrets) : " Platforms: whichever deploy platforms have a secrets adapter.";
  const common = `${listed} Use these instead of custom_credential_make_request for deploy checks on these platforms. They don't deploy or change anything; to start a deploy use deployment_ops_deploy. For a static-site publish use deployment_get_static_publish_capabilities / the publish tools instead. Refuses unknown platforms, ambiguous credentials, saved-host mismatches, and rejected auth (use custom_credential_verify).`;
  const base = { platform: { type: "string", enum: ids }, target: { type: "string", minLength: 1, maxLength: 200, description: "App name or owner/repo, as required by the platform." }, credentialLabel: { type: "string", minLength: 1, maxLength: 200 }, runId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$" }, branch: { type: "string", minLength: 1, maxLength: 200 } };
  const definition = ({ name, description, properties, required }: { name: string; description: string; properties: Record<string, unknown>; required: string[] }, _options = {}): AgentToolDefinition => ({ name, description: description + common, sideEffects: "none", authorization: { permission: required.readPermission }, inputSchema: { type: "object", additionalProperties: false, properties, required } });
  return [
    definition({ name: "deployment_ops_status", description: "Check whether an app is up, running and healthy or whether a deployment workflow build passed or failed. Returns platform, target, healthy/deploying/failing/stopped/unknown state, summary, machine/job items, optional run URL and checkedAt.", properties: base, required: ["platform", "target"] }),
    definition({ name: "deployment_ops_logs", description: "Read bounded error logs to explain why a hosted app crashed or a deployment workflow build failed. Returns platform, target, lines with message and optional time/source/level, and truncated. Workflow adapters return failed steps and check annotations, not the redirected full log archive.", properties: { ...base, limit: { type: "integer", minimum: 1, maximum: 500, clamp: true, default: 100 } }, required: ["platform", "target"] }),
    definition({ name: "deployment_ops_wait", description: "Wait until an app is healthy or a workflow is finished; poll status every 10 seconds and tell the user when it is done. Returns reached, waitedSeconds, polls and last status; reached:false on timeout. Finished includes failure/stopped; unknown is not finished. Cancellation stops polling.", properties: { ...base, until: { type: "string", enum: ["healthy", "finished"] }, timeoutSeconds: { type: "integer", minimum: 10, maximum: MAX_WAIT_SECONDS, default: 180 } }, required: ["platform", "target", "until"] }),
    definition({ name: "deployment_ops_list_targets", description: "List my apps or other deployment targets on a supported platform before choosing one to inspect. Returns platform and targets with id, name and optional state. Listing may be unsupported by the platform; then supply a target to status.", properties: { platform: base.platform, credentialLabel: base.credentialLabel, org: { type: "string", minLength: 1, maxLength: 200, description: "Optional organization slug." } }, required: ["platform"] }),
    {
      name: "deployment_ops_deploy",
      description: `Deploy, ship or redeploy my server app now through a supported platform, using one saved credential. Returns platform, target, started (false means nothing was dispatched; follow the summary to select or enable a workflow), summary, and when the platform provides them runId, sha, machineIds, image and url. For workflow-based platforms, target identifies the repository holding the deployment workflow; the hosting plugin describes its workflow, ref pinning and required credential permissions. started means the platform accepted the deploy, not that it has landed: next call deployment_ops_wait with the same platform and target (plus runId when returned) until 'finished', then check the live site with fetch_live_url. Never retry a deploy whose connection dropped before checking deployment_ops_status. Refuses platforms without a deploy adapter, unknown platforms, ambiguous credentials, saved-host mismatches and rejected auth (use custom_credential_verify). Does not copy site content to the server; a static-site publish uses deployment_execute_static_publish.${listed}`,
      sideEffects: "mutates-durable-state",
      authorization: { permission: required.writePermission },
      inputSchema: { type: "object", additionalProperties: false, properties: { platform: base.platform, target: base.target, ref: { type: "string", minLength: 1, maxLength: 200, description: "Branch, tag or commit, as the platform supports; the hosting plugin's skill says which." }, workflowFile: { type: "string", description: "Optional workflow filename from an installed, active deployment config. Required when several workflows are declared." }, credentialLabel: base.credentialLabel }, required: ["platform", "target"] },
    },
    ...secretTools({ platforms: secrets.map(p => p.id), target: base.target, credentialLabel: base.credentialLabel, listed: secretsListed, readPermission: required.readPermission, writePermission: required.writePermission, secretNameDescription: required.secretNameDescription, unsetSecretDescription: required.unsetSecretDescription }),
  ];
}
/** Generic host-secrets tools; vendors are the bundled deployment plugins' adapters, never per-vendor tools. O(1). */
function secretTools(required: { platforms: string[]; target: Record<string, unknown>; credentialLabel: Record<string, unknown>; listed: string; readPermission: string; writePermission: string; secretNameDescription: string; unsetSecretDescription: string }): AgentToolDefinition[] {
  const { platforms, target, credentialLabel, listed } = required;
  const name = { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$", description: required.secretNameDescription };
  const common = ` Works for any platform whose adapter supports secrets; others are refused with the list of platforms that do. Never returns a secret value or accepts one in model input.${listed}`;
  const targetProps = { platform: { type: "string", enum: platforms }, target, credentialLabel };
  return [
    {
      name: "deployment_ops_list_secrets",
      description: `List the secrets (environment variables) set on a hosted app: names, the platform's own digest and update time only, never values. Returns platform, target, secrets [{name, digest?, updatedAt?}], truncated, appliesOn (next-deploy | vendor-restart | immediately), supportsStaging and deployNeeded (true when writes wait for the next deploy).${common}`,
      sideEffects: "none",
      authorization: { permission: required.readPermission },
      inputSchema: { type: "object", additionalProperties: false, properties: targetProps, required: ["platform", "target"] },
    },
    {
      name: "deployment_ops_set_secret",
      description: `Set or copy a secret (environment variable) on a hosted app from a server-side source or a masked secure card; the assistant never sees the value. source {kind:'typed'} opens the masked card for a new key such as API_KEY; the human types the value there. source {kind:'site-key'} copies this site's own site key (needs the site-key permission); source {kind:'secret', name} copies another secret already on the same target (platform side, value never shown). Compares first: if the stored value is identical nothing is written (comparison 'same'). Replacing an existing secret asks the human to confirm on a card; creating a new one does not. dryRun:true only compares. Returns platform, target, name, source, comparison (same | different | absent | unknown), changed, fingerprint and fingerprintKind ('site-key' fingerprints match the admin Security page), appliesOn, supportsStaging, deployNeeded, optional version and dryRun, and summary; a declined card returns changed:false with cancelled/reason/note. Writes are staged where the platform allows: when deployNeeded is true, run deployment_ops_deploy afterwards.${common}`,
      sideEffects: "mutates-durable-state",
      authorization: { permission: required.writePermission },
      inputSchema: { type: "object", additionalProperties: false, properties: {
        ...targetProps, name,
        source: { type: "object", additionalProperties: false, description: "Where the server reads the value. kind 'typed' opens a secure card and takes no value; kind 'site-key' takes no name; kind 'secret' requires name (another secret on the same target).", properties: { kind: { type: "string", enum: ["site-key", "secret", "typed"] }, name }, required: ["kind"] },
        dryRun: { type: "boolean", default: false, description: "Only compare and report; write nothing." },
      }, required: ["platform", "target", "name", "source"] },
    },
    {
      name: "deployment_ops_unset_secret",
      description: required.unsetSecretDescription + common,
      sideEffects: "deletes-durable-state",
      authorization: { permission: required.writePermission },
      inputSchema: { type: "object", additionalProperties: false, properties: { ...targetProps, name }, required: ["platform", "target", "name"] },
    },
  ];
}
