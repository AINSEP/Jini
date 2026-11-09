// Mechanical extraction provenance is recorded in this package's source-map.md.
import { nowIso } from '@jini-ai/core/primitives';
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, type ToolHandler, type ToolRegistration } from '@jini-ai/core';
import type { DeployOpsRuntime, DeployOpsRegistrationHost, SecretValueSource } from './ops-tool-contracts.js';
import type { DeployOpsInput } from './ops-contracts.js';
import { collectTypedDeploySecret } from './ops-secret-card.js';
import { runListSecrets, runSetSecret, runUnsetSecret } from './ops-secrets.js';
import { DeployCredentialSetupRequired, MAX_WAIT_SECONDS, runDeploy, runDeployOps, waitForDeployOps } from './ops-runner.js';
/** Read a bounded string; JSON schema alone cannot protect direct calls to the handler. */
function string(input: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new ToolInputError({ message: `${key} must be a non-empty string of at most 200 characters.` });
  return value;
}
/** Enforce integer bounds even when a caller bypasses schema validation. */
function integer(input: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = input[key] === undefined ? fallback : input[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new ToolInputError({ message: `${key} must be an integer from ${min} to ${max}.` });
  return value;
}
/** Validate deploy input independently of the schema, then call the same feature function as the admin route. */
function deployHandler(deps: DeployOpsRuntime, input: Record<string, unknown>, signal?: AbortSignal | undefined) {
  onlyKeys(input, ["platform", "target", "ref", "credentialLabel", "workflowFile"]);
  const ref = string(input, "ref"); const credentialLabel = string(input, "credentialLabel");
  return runDeploy({ deps, input: { platform: string(input, "platform", true)!, target: string(input, "target", true)!, workflowFile: string(input, "workflowFile"), ...(ref !== undefined ? { ref } : {}), ...(credentialLabel !== undefined ? { credentialLabel } : {}) } }, { signal });
}
function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new ToolInputError({ message: `Unexpected deployment ops input '${key}'.` });
}
/** `source` is a closed shape: a value can never ride in on it. O(1). */
function valueSource(raw: unknown): SecretValueSource {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ToolInputError({ message: "source must be {kind:'typed'}, {kind:'site-key'} or {kind:'secret', name}." });
  const record = raw as Record<string, unknown>;
  if ((record.kind === "typed" || record.kind === "site-key") && Object.keys(record).length === 1) return { kind: record.kind };
  if (record.kind === "secret" && typeof record.name === "string" && Object.keys(record).length === 2) return { kind: "secret", name: record.name };
  throw new ToolInputError({ message: "source must be {kind:'typed'}, {kind:'site-key'} or {kind:'secret', name}." });
}
type Permit = (permission: string) => Promise<void>;
const SECRET_KEYS: Record<string, readonly string[]> = {
  list: ["platform", "target", "credentialLabel"],
  unset: ["platform", "target", "credentialLabel", "name"],
  set: ["platform", "target", "credentialLabel", "name", "source", "dryRun"],
};
/** Secrets handlers: validation independent of the schema; copying the site key also needs the site-key permission. */
function secretsHandler(deps: DeployOpsRuntime, host: DeployOpsRegistrationHost, name: string, permit: Permit): ToolHandler {
  return async (ctx, options) => {
    const input = requireInputRecord({ input: ctx.input });
    const role = name === deps.toolIds.unsetSecret ? "unset" : "set";
    onlyKeys(input, SECRET_KEYS[name === deps.toolIds.listSecrets ? "list" : role]!);
    const target = { platform: string(input, "platform", true)!, target: string(input, "target", true)!, credentialLabel: string(input, "credentialLabel") };
    if (name === deps.toolIds.listSecrets) return runListSecrets({ deps, input: target }, { signal: ctx.signal });
    const optional = { signal: ctx.signal, confirm: host.approvals.confirmFor({ctx,permit}, options ?? {}) };
    if (name === deps.toolIds.unsetSecret) return runUnsetSecret({ deps, input: { ...target, name: string(input, "name", true)! } }, optional);
    const source = valueSource(input.source);
    if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") throw new ToolInputError({ message: "dryRun must be a boolean." });
    if (source.kind === "site-key") await permit(host.permissions.siteKey);
    const setInput = { ...target, name: string(input, "name", true)!, source, dryRun: input.dryRun === true };
    if (source.kind === "typed") return collectTypedDeploySecret({ ctx, deps, cards:host.cards, input: setInput, permit: () => permit(host.permissions.write) }, { ...options, confirm: optional.confirm });
    return runSetSecret({ deps, input: setInput }, optional);
  };
}
function observationInput({ deps, name, input }: { deps:DeployOpsRuntime; name: string; input: Record<string, unknown> }, _optional = {}): DeployOpsInput {
  const isList = name === deps.toolIds.listTargets;
  const allowed = isList ? ["platform", "credentialLabel", "org"] : ["platform", "target", "credentialLabel", "runId", "branch", ...(name === deps.toolIds.logs ? ["limit"] : []), ...(name === deps.toolIds.wait ? ["until", "timeoutSeconds"] : [])];
  onlyKeys(input, allowed);
  const args: DeployOpsInput = { platform: string(input, "platform", true)!, target: isList ? "" : string(input, "target", true)!, credentialLabel: string(input, "credentialLabel"), ...(isList ? { org: string(input, "org") } : { runId: string(input, "runId"), branch: string(input, "branch") }) };
  return args;
}

async function observationHandler({ deps, input, name }: { deps: DeployOpsRuntime; input: Record<string, unknown>; name: string }, { signal }: { signal?: AbortSignal | undefined } = {}) {
  const args = observationInput({ deps, name, input }, {});
  if (name === deps.toolIds.listTargets) return await runDeployOps({deps,input:args,operation:"listTargets"}, {signal});
  if (name === deps.toolIds.logs) return await runDeployOps({deps,input:{ ...args, limit: integer(input, "limit", 100, 1, 500) },operation:"logs"}, {signal});
  if (name === deps.toolIds.status) return await runDeployOps({deps,input:args,operation:"status"}, {signal});
  if (input.until !== "healthy" && input.until !== "finished") throw new ToolInputError({ message: "until must be 'healthy' or 'finished'." });
  return await waitForDeployOps({ status: signal => runDeployOps({deps,input:args,operation:"status"}, {signal}), clock: deps.waitClock, initial: { platform: args.platform, target: args.target, state: "unknown", summary: "No status received before timeout.", items: [], checkedAt: nowIso({ clock: deps.clock }) } }, { until: input.until, timeoutSeconds: integer(input, "timeoutSeconds", 180, 10, MAX_WAIT_SECONDS), signal });
}

/** Permission precedes any plugin/credential read. Handler input validation is independent of the schema. */
export function buildDeployOpsRegistrations({deps,host}: {deps:DeployOpsRuntime;host:DeployOpsRegistrationHost}, _optional = {}): ToolRegistration[] {
  const catalog = host.catalog;
  const handlers: Record<string, ToolHandler> = {};
  for (const tool of catalog) handlers[tool.name] = async (ctx, options) => {
    try {
      const permit: Permit = permission => host.permit({ctx,permission}, {});
      await permit(tool.authorization.permission);
      if ([deps.toolIds.listSecrets,deps.toolIds.setSecret,deps.toolIds.unsetSecret].includes(tool.name)) return await secretsHandler(deps, host, tool.name, permit)(ctx, options);
      const input = requireInputRecord({ input: ctx.input });
      if (tool.name === deps.toolIds.deploy) return await deployHandler(deps, input, ctx.signal);
      return await observationHandler({ deps, input, name: tool.name }, { signal: ctx.signal });
    } catch (error) {
      if (error instanceof DeployCredentialSetupRequired) return { executed: false, credentialSetup: error.credentialSetup };
      throw error;
    }
  };
  return buildDomainRegistrations({ metadata: host.metadata, domain: host.domain, catalogModule: host.catalogModule, catalog: indexCatalogById({ catalog: catalog }), handlers, derivedRisk: host.derivedRisk });
}
