import { adaptLegacyAuthorize, requireToolPermission, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, ToolInputError, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from '@jini-ai/core';
import { PluginInstallError } from '../node/install.js';
import { PluginSourceError, type PluginSourcePort } from '../node/source-drafts.js';
import type { PluginSourceToolsRequired } from './contract.js';
const MUTATES_DURABLE_STATE = 'mutates-durable-state' as const;


/** Reads one required string field, naming it when the caller sent something else. */
function stringField(required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  input: Record<string, unknown>; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  key: string }): string {
  const value = required.input[required.key];
  if (typeof value !== 'string') throw new ToolInputError({ message: `${required.key} must be a string.` });
  return value;
}


type SourceOperation = (required: { 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  port: PluginSourcePort; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  pluginId: string; 
  /** @agent-note Preserve the existing caller-safe plugin protocol value and saved/result bytes; do not infer host authority or disclose private paths, secrets or handles. */
  input: Record<string, unknown> }) => Promise<unknown>;


/** One port call per non-confirming source tool; fields are read in argument order. */
function sourceOperations(toolIds: PluginSourceToolsRequired<unknown>['toolIds']): Partial<Record<string, SourceOperation>> { return {
  [toolIds.create]: ({ port, pluginId, input }) => port.create({ id: pluginId, name: stringField({ input, key: 'name' }), description: stringField({ input, key: 'description' }) }, {}),
  [toolIds.open]: ({ port, pluginId }) => port.open({ id: pluginId }, {}),
  [toolIds.list]: ({ port, pluginId }) => port.list({ id: pluginId }, {}),
  [toolIds.read]: ({ port, pluginId, input }) => port.read({ id: pluginId, path: stringField({ input, key: 'path' }) }, {}),
  [toolIds.write]: ({ port, pluginId, input }) => port.write({ id: pluginId, path: stringField({ input, key: 'path' }), content: stringField({ input, key: 'content' }) }, {}),
  [toolIds.edit]: ({ port, pluginId, input }) => {
    if (input.replaceAll !== undefined && typeof input.replaceAll !== 'boolean') throw new ToolInputError({ message: 'replaceAll must be a boolean.' });
    return port.edit({ id: pluginId, path: stringField({ input, key: 'path' }), oldString: stringField({ input, key: 'oldString' }), newString: stringField({ input, key: 'newString' }), ...(input.replaceAll === undefined ? {} : { replaceAll: input.replaceAll }) }, {});
  },
  [toolIds.seal]: ({ port, pluginId }) => port.seal({ id: pluginId }, {}),
  [toolIds.rollback]: ({ port, pluginId }) => port.rollback({ id: pluginId }, {}),
}; }


/** Bind authenticated chat operations to the existing source owner and shared approval transport.
 * @param required Narrow site deps and human exchange transport.
 * @param _optional Reserved registration options.
 * @returns Complete registrations; typed source/install refusals become actionable input errors.
 */
/** @agent-note Required host inputs have no vocabulary defaults. Bind the same workspace-scoped lifecycle, canonical classes, command/fingerprint owners and authenticated approval transport. Authorize before disclosure and after approval; preserve saved identity bytes, privacy, order, rollback/Stop, I/O and telemetry counts, and unknown failure identity. */
export function buildPluginSourceRegistrations<Description>(deps: PluginSourceToolsRequired<Description>, _optional = {}): ToolRegistration[] {
  const operations = sourceOperations(deps.toolIds);
  async function authorize(ctx: ToolExecutionContext, permission: string): Promise<void> {
    await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission }, { entityType: deps.entityType });
  }
  function source(): PluginSourcePort {
    if (!deps.pluginSource) throw new ToolInputError({ message: 'Site plugin source authoring is unavailable: this site has no plugin directory.' });
    return deps.pluginSource;
  }
  async function relay<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (error) {
      if (error instanceof PluginSourceError || error instanceof PluginInstallError) throw new ToolInputError({ message: `${error.code}: ${error.message}` });
      throw error;
    }
  }
  const handlers: Record<string, ToolHandler> = {};
  for (const tool of deps.registration.catalog) {
    const operation = operations[tool.name];
    // plugin_source_delete has no direct operation: its approval handler is bound below.
    if (!operation) continue;
    handlers[tool.name] = async ctx => {
      await authorize(ctx, tool.authorization.permission);
      const input = requireInputRecord({ input: ctx.input });
      const pluginId = requireString({ input, key: 'id' });
      // The port is resolved before any field is read, so a missing owner is reported first.
      return relay(async () => operation({ port: source(), pluginId, input }));
    };
  }
  // Only permanent source-file deletion asks. The approved file text is pinned across the wait;
  // neither the model's input nor a later draft edit can stand in for human approval.
  handlers[deps.toolIds.delete] = deps.approvals.handler({
    prepare: async ({ ctx }) => {
      await authorize(ctx, deps.enablePermission);
      const input = requireInputRecord({ input: ctx.input });
      const target = { id: requireString({ input, key: 'id' }), path: requireString({ input, key: 'path' }) };
      const prior = await relay(() => source().read(target, {}));
      return { target, prior };
    },
    describe: ({ prepared }) => deps.describeDelete({ target: prepared.target }),
    run: async ({ ctx, prepared }) => {
      await authorize(ctx, deps.enablePermission);
      return relay(() => source().delete(prepared.target, { expectedDigest: prepared.prior.digest }));
    },
  }, { flag: 'deleted' });
  return buildDomainRegistrations({ ...deps.registration, catalog: indexCatalogById({ catalog: deps.registration.catalog }), derivedRisk: pluginSourceDerivedRiskFor({ toolIds: deps.toolIds }), handlers });
}

/** Independently derived from calls to the source port: reads are read-only, delete unlinks,
 * and create/open/write/edit/seal/rollback durably publish bytes. */
/** @agent-note Required host inputs have no vocabulary defaults. Bind the same workspace-scoped lifecycle, canonical classes, command/fingerprint owners and authenticated approval transport. Authorize before disclosure and after approval; preserve saved identity bytes, privacy, order, rollback/Stop, I/O and telemetry counts, and unknown failure identity. */
export function pluginSourceDerivedRiskFor({ toolIds }: { 
  /** @agent-note Host ids are required input for every operation; never replace them with this package or another host's names. */
  toolIds: PluginSourceToolsRequired<unknown>['toolIds'] }, _optional = {}): DerivedRiskByToolId { return new Map([
  [toolIds.create, MUTATES_DURABLE_STATE], [toolIds.open, MUTATES_DURABLE_STATE],
  [toolIds.list, 'none'], [toolIds.read, 'none'], [toolIds.write, MUTATES_DURABLE_STATE],
  [toolIds.edit, MUTATES_DURABLE_STATE], [toolIds.delete, 'deletes-durable-state'],
  [toolIds.seal, MUTATES_DURABLE_STATE], [toolIds.rollback, MUTATES_DURABLE_STATE],
]); }
