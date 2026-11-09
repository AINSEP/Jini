// Mechanical extraction provenance is recorded in this package's source-map.md.
import { isDeepStrictEqual } from 'node:util';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ToolInputError } from '@jini-ai/core';
import type { DeployOpsRuntime, SecretValueSource, SecretTargetInput, SetSecretInput, UnsetSecretInput, SecretComparison, SecretConfirmRequest, SecretConfirm, SetSecretResult, UnsetSecretResult } from './ops-tool-contracts.js';
import type { DeployOpsContext, DeployOpsSecretInfo, DeployOpsSecretRead, DeployOpsSecretWrite, LoadedDeployOps } from './ops-contracts.js';
import { requireDeployPlatform } from './ops-registry.js';
import { aborted, boundContext } from './ops-runner.js';
/**
 * @file Generic host-secrets verbs (owner 2026-10-05: "a tool that sets and unsets secrets ... not just
 * for one host ... it should work for really any vendor"). Vendors are adapters exported by the trusted
 * deploy plugin's deploy-ops modules (`listSecrets`/`setSecret`/`unsetSecret`, optional `readSecret`);
 * this file owns everything vendor-neutral: the value source, the compare-before-write, the human
 * confirmation before an overwrite or removal, and a result that never carries a secret value.
 *
 * A value never comes from the model. `source` names where the server reads it: this site's own key
 * (`site-key`), or another secret on the same target (`secret`, copied vendor side through
 * `readSecret`). Values stay inside this process: the audit records metadata only, and the result
 * reports a one-way fingerprint.
 */
export const SECRET_NAME_PATTERN = /^[A-Za-z_]\w{0,127}$/;
const clip = (value: unknown, max: number) => String(value).slice(0, max);
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Constant-time over fixed-length digests, so neither length nor prefix leaks through timing. O(n). */
function sameValue(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

function requireSiteKey(deps: DeployOpsRuntime): string {
  const hex = deps.siteKey.read({}, {});
  if (!hex) throw new ToolInputError({message:deps.messages.noUsableSiteKey});
  return hex;
}

/** Refuse unknown platforms and platforms without a secrets adapter before any credential or network work. */
async function secretsPlatform(deps: DeployOpsRuntime, id: string, signal?: AbortSignal | undefined): Promise<LoadedDeployOps> {
  if (signal?.aborted) throw aborted();
  const registry = await deps.loadDeployOps({ workspaceId: deps.workspaceId });
  const platform = requireDeployPlatform({registry,id}, {});
  if (!platform.module.setSecret || !platform.module.secretCapabilities) {
    const capable = registry.list().filter(p => typeof p.module.setSecret === "function").map(p => p.descriptor.id);
    throw new ToolInputError({ message: `Deployment ops platform '${id}' has no secrets adapter. Platforms with one: ${capable.join(", ") || "(none)"}.` });
  }
  return platform;
}

function requireName(value: string, key = "name"): string {
  if (!SECRET_NAME_PATTERN.test(value)) throw new ToolInputError({ message: `${key} must be an environment variable name (letters, digits and underscores, not starting with a digit, at most 128 characters).` });
  return value;
}

/** Keep only documented fields; a malformed adapter result is refused rather than echoed. O(secrets). */
async function listNormalized(platform: LoadedDeployOps, ctx: DeployOpsContext, target: string): Promise<{ secrets: DeployOpsSecretInfo[]; truncated: boolean }> {
  const result = await platform.module.listSecrets!(ctx, { target });
  if (!Array.isArray(result?.secrets) || result.secrets.some(s => !s || typeof s.name !== "string" || !s.name)) throw new ToolInputError({ message: `Deployment ops platform '${platform.descriptor.id}' returned an invalid secret list.` });
  const secrets = result.secrets.slice(0, 500).map(s => ({ name: clip(s.name, 128), ...(typeof s.digest === "string" ? { digest: clip(s.digest, 200) } : {}), ...(typeof s.updatedAt === "string" ? { updatedAt: clip(s.updatedAt, 64) } : {}) }));
  return { secrets, truncated: result.truncated === true || result.secrets.length > 500 };
}

const applies = (platform: LoadedDeployOps) => {
  const { appliesOn, supportsStaging } = platform.module.secretCapabilities!;
  return { appliesOn, supportsStaging, deployNeeded: appliesOn === "next-deploy" };
};
const version = (write: DeployOpsSecretWrite | undefined): { version?: string } => (typeof write?.version === "string" || typeof write?.version === "number" ? { version: clip(write.version, 64) } : {});
const nextStep = (deps:DeployOpsRuntime, platform: LoadedDeployOps, target: string) => (platform.module.secretCapabilities!.appliesOn === "next-deploy" ? ` The running app keeps the old environment until the next deploy of '${target}' (${deps.toolIds.deploy}).` : "");

/**
 * List a target's secret names with the vendor's digest and update time; never a value.
 * @param required - `deps`: saved-credential ports and the no-redirect client; `input`: platform, target, optional credential label.
 * @param optional - `signal` cancels before further requests.
 * @returns Names, vendor digests, update times, truncation and when writes take effect.
 * @throws {ToolInputError} Unknown or secrets-less platforms, credential/host/auth failures, malformed adapter output.
 * @complexity Time and space: O(credentials + secrets).
 * @example await runListSecrets({ deps, input: { platform: "my-host", target: "my-app" } });
 */
export async function runListSecrets(required: { deps: DeployOpsRuntime; input: SecretTargetInput }, optional: { signal?: AbortSignal | undefined } = {}) {
  const { deps, input } = required; const { signal } = optional;
  const platform = await secretsPlatform(deps, input.platform, signal);
  const ctx = await boundContext({deps,platform,explicit:input.credentialLabel}, {signal});
  const listed = await listNormalized(platform, ctx, input.target);
  return { platform: input.platform, target: input.target, ...listed, ...applies(platform) };
}

/** Read the source value server side. A copy needs the adapter's read verb and a source that exists. */
async function resolveValue({ deps, platform, ctx, input, siteKey }: { deps:DeployOpsRuntime; platform: LoadedDeployOps; ctx: DeployOpsContext; input: SetSecretInput; siteKey: string | undefined }, { typedValue }: { typedValue?: unknown } = {}): Promise<string> {
  if (input.source.kind === "typed") return requireTypedValue({ value: typedValue }, {});
  if (siteKey !== undefined) return siteKey;
  const source = input.source as { kind: "secret"; name: string };
  const read = await platform.module.readSecret!(ctx, { target: input.target, name: source.name });
  if (!read || !("value" in read) || typeof read.value !== "string") throw new ToolInputError({ message: `Secret '${source.name}' is not set on '${input.target}', so there is nothing to copy. List the secrets with ${deps.toolIds.listSecrets}.` });
  return read.value;
}

function comparisonOfRead({ current, value }: { current: DeployOpsSecretRead | undefined; value: string }, _optional = {}): SecretComparison | undefined {
  if (current && "value" in current && typeof current.value === "string") return sameValue(current.value, value) ? "same" : "different";
  if (current && "absent" in current && current.absent === true) return "absent";
  return undefined;
}

async function readComparison({ platform, ctx, input, value }: { platform: LoadedDeployOps; ctx: DeployOpsContext; input: SetSecretInput; value: string }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<SecretComparison | undefined> {
  if (platform.module.readSecret) {
    try {
      const current = await platform.module.readSecret(ctx, { target: input.target, name: input.name });
      return comparisonOfRead({ current, value }, {});
    } catch (error) { if (signal?.aborted) throw error; /* An unreadable value (e.g. a token without secret-read scope) degrades to a presence check. */ }
  }
  return undefined;
}

/** Compare the stored value when the adapter can read it; otherwise only a complete list can establish absence. */
async function compareCurrent(platform: LoadedDeployOps, ctx: DeployOpsContext, input: SetSecretInput, value: string, signal?: AbortSignal | undefined): Promise<SecretComparison> {
  const comparison = await readComparison({ platform, ctx, input, value }, { signal });
  if (comparison !== undefined) return comparison;
  const listed = await listNormalized(platform, ctx, input.target);
  return listed.truncated || listed.secrets.some(s => s.name === input.name) ? "unknown" : "absent";
}

/** Fail closed: an overwrite or removal without a confirmation channel never runs. */
async function confirmOrRefuse(confirm: SecretConfirm | undefined, request: SecretConfirmRequest) {
  if (!confirm) throw new ToolInputError({ message: `Changing existing secret '${request.name}' needs a human confirmation, and this call has no way to ask. Nothing was changed.` });
  return confirm(request);
}

function validateSetInput(platform: LoadedDeployOps, input: SetSecretInput): void {
  requireName(input.name);
  if (input.source.kind !== "secret") return;
  requireName(input.source.name, "source.name");
  if (input.source.name === input.name) throw new ToolInputError({ message: "source.name must differ from name; a secret cannot be copied onto itself." });
  if (!platform.module.readSecret) throw new ToolInputError({ message: `Deployment ops platform '${input.platform}' cannot read secret values, so it cannot copy one secret to another. Use source kind 'site-key'.` });
}

/** Private card-only value: preserve bytes and refuse missing values without displaying them. */
function requireTypedValue({ value }: { value: unknown }, _optional = {}): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 8192) throw new ToolInputError({ message: "The secure form requires a non-blank secret of at most 8192 characters." });
  return value;
}

function describeSource({ source }: { source: SecretValueSource }, _optional = {}): string {
  if (source.kind === "site-key") return "this site's key";
  return source.kind === "typed" ? "the secure card" : `secret ${source.name}`;
}

/**
 * Set one secret on a host target from a server-side source; skips the write when the value is already there.
 * @param required - `deps`: credential ports, no-redirect client, site-key reader; `input`: platform, target, name, source, optional dryRun and credential label.
 * @param optional - `signal` cancels; `confirm` asks a human before an existing secret is replaced.
 * @returns changed, comparison, the value's fingerprint, when it applies, and an optional vendor version. Never the value.
 * @throws {ToolInputError} Invalid names, unusable sources, secrets-less platforms, credential/host/auth failures, or an overwrite with no confirm channel.
 * @complexity Time: O(credentials + secrets + value length) plus at most four adapter requests. Space: O(secrets).
 * @example await runSetSecret({ deps, input: { platform: "my-host", target: "my-app", name: "APP_SITE_KEY", source: { kind: "site-key" } } }, { confirm });
 */
/** @agent-note The confirm callback must approve the frozen overwrite request through an authenticated human answer. */
export async function runSetSecret(required: { deps: DeployOpsRuntime; input: SetSecretInput }, optional: { signal?: AbortSignal | undefined; confirm?: SecretConfirm | undefined; typedValue?: unknown } = {}): Promise<SetSecretResult> {
  const { deps, input } = required; const { signal, confirm } = optional;
  const platform = await secretsPlatform(deps, input.platform, signal);
  validateSetInput(platform, input);
  const siteKey = input.source.kind === "site-key" ? requireSiteKey(deps) : undefined;
  const ctx = await boundContext({deps,platform,explicit:input.credentialLabel}, {signal});
  const value = await resolveValue({ deps, platform, ctx, input, siteKey }, { typedValue: optional.typedValue });
  const comparison = await compareCurrent(platform, ctx, input, value, signal);
  const source = describeSource({ source: input.source }, {});
  const base = { platform: input.platform, target: input.target, name: input.name, source: input.source, comparison, ...deps.siteKey.fingerprint({value}, {}), ...applies(platform) };
  if (comparison === "same") return { ...base, changed: false, deployNeeded: false, summary: `'${input.name}' on '${input.target}' already holds ${source}; nothing was written.` };
  if (input.dryRun) return { ...base, changed: false, dryRun: true, deployNeeded: false, summary: `Dry run: '${input.name}' would be ${comparison === "absent" ? "created" : "replaced"} from ${source}. Nothing was written.` };
  if (comparison !== "absent") {
    const decision = await confirmOrRefuse(confirm, { action: "overwrite", platform: input.platform, target: input.target, name: input.name, source, comparison, appliesOn: base.appliesOn });
    if (!decision.confirmed) return { ...base, changed: false, deployNeeded: false, ...decision.result };
  }
  if (signal?.aborted) throw aborted();
  const write = await platform.module.setSecret!(ctx, { target: input.target, name: input.name, value });
  return { ...base, changed: true, ...version(write), summary: `Set '${input.name}' on '${input.target}' from ${source}.${nextStep(deps, platform, input.target)}` };
}

/** Confirmation must be tied to an identifiable provider version. */
function requireSecretSnapshot({ deps, secrets, name }: { deps:DeployOpsRuntime; secrets: DeployOpsSecretInfo[]; name: string }, _optional = {}): DeployOpsSecretInfo {
  const targetSnapshot = secrets.find(secret => secret.name === name);
  if (!targetSnapshot || (!targetSnapshot.digest && !targetSnapshot.updatedAt)) throw new ToolInputError({ message: `${deps.toolIds.unsetSecret}: the provider cannot identify the current secret version safely. Remove it in the provider console; nothing was deleted.` });
  return targetSnapshot;
}

/**
 * Remove one secret from a host target after a human confirms; an absent name is reported, not deleted.
 * @param required - `deps`: credential ports and the no-redirect client; `input`: platform, target, name, optional credential label.
 * @param optional - `signal` cancels; `confirm` is required for an actual removal.
 * @returns removed, when the removal applies, and an optional vendor version.
 * @throws {ToolInputError} Invalid names, secrets-less platforms, credential/host/auth failures, or no confirm channel.
 * @complexity Time and space: O(credentials + secrets) plus at most three adapter requests.
 * @example await runUnsetSecret({ deps, input: { platform: "my-host", target: "my-app", name: "OLD_KEY" } }, { confirm });
 */
/** @agent-note The confirm callback must approve the frozen removal request through an authenticated human answer. */
export async function runUnsetSecret(required: { deps: DeployOpsRuntime; input: UnsetSecretInput }, optional: { signal?: AbortSignal | undefined; confirm?: SecretConfirm | undefined } = {}): Promise<UnsetSecretResult> {
  const { deps, input } = required; const { signal, confirm } = optional;
  const platform = await secretsPlatform(deps, input.platform, signal);
  requireName(input.name);
  const ctx = await boundContext({deps,platform,explicit:input.credentialLabel}, {signal,allowDelete:true});
  const listed = await listNormalized(platform, ctx, input.target);
  const base = { platform: input.platform, target: input.target, name: input.name, ...applies(platform) };
  if (!listed.truncated && !listed.secrets.some(s => s.name === input.name)) return { ...base, removed: false, deployNeeded: false, summary: `'${input.name}' is not set on '${input.target}'; nothing was removed.` };
  const targetSnapshot = requireSecretSnapshot({ deps, secrets: listed.secrets, name: input.name }, {});
  const decision = await confirmOrRefuse(confirm, { action: "remove", platform: input.platform, target: input.target, name: input.name, appliesOn: base.appliesOn });
  if (!decision.confirmed) return { ...base, removed: false, deployNeeded: false, ...decision.result };
  if (signal?.aborted) throw aborted();
  const current = (await listNormalized(platform, ctx, input.target)).secrets.find(secret => secret.name === input.name);
  if (!isDeepStrictEqual(current, targetSnapshot)) throw new ToolInputError({ message: `${deps.toolIds.unsetSecret}: target changed while confirmation was open. Request a new confirmation; nothing was deleted.` });
  const write = await platform.module.unsetSecret!(ctx, { target: input.target, name: input.name });
  return { ...base, removed: true, ...version(write), summary: `Removed '${input.name}' from '${input.target}'.${nextStep(deps, platform, input.target)}` };
}
