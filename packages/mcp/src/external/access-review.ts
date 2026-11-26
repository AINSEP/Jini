import { requireInputRecord, requireString, redactSecrets, ToolInputError, type ToolHandler } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { ExternalMcpAccessSnapshot, ExternalMcpServerRecord, SaveExternalMcpServerInput } from '@jini-ai/core/contracts/hosted-mcp';
import { applyExternalMcpAccess, externalMcpAccessSnapshot, parseArgs, parseAllowedToolNames, parseWriteAllowedToolNames, readExternalMcpToolGrants, ExternalMcpValidationError } from '../federation/hosted/index.js';
import { EXTERNAL_MCP_MANAGE_PERMISSION } from './agent-tools.js';
import { EXTERNAL_MCP_SAVE_TOOL_ID } from './save-form.js';
import { optionalStringField } from './save-input.js';
import type { ExternalMcpToolDeps } from './tool-registrations.js';

const EXTERNAL_MCP_ENTITY_TYPE = "external-mcp-server" as const;

/** Access-only proposals name an existing source and cannot alter its endpoint or credentials.
 * @complexity O(k) in the fixed input-key list; no effects.
 */
export function isExternalMcpAccessInput(input: Record<string, unknown>): boolean {
  const fields = ['id', 'transport', 'enabled', 'allowedToolNames', 'writeAllowedToolNames'];
  return Object.keys(input).every(key => fields.includes(key)) &&
    ['enabled', 'allowedToolNames', 'writeAllowedToolNames'].some(key => Object.hasOwn(input, key));
}

/** Reuse management authorization both before disclosing the source and immediately before apply. */
async function authorizeMcpAccess({ routeDeps, principalId, id }: { routeDeps: ExternalMcpToolDeps; principalId: string; id: string }): Promise<void> {
  await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
    workspaceId: routeDeps.workspaceId, principalId, permission: EXTERNAL_MCP_MANAGE_PERMISSION },
  { entityType: EXTERNAL_MCP_ENTITY_TYPE, entityId: id });
}

/** Redact existing credential-bearing endpoint/command shapes before placing them on a card.
 * The unredacted admission fingerprint stays private to the conditional writer.
 * @complexity O(t) source-label/target bytes; no I/O.
 */
function externalMcpAccessSubject({ record, id }: { record: ExternalMcpServerRecord; id: string }) {
  const target = record.transport === 'stdio' ? `${record.command ?? ""} ${record.args ?? ""}` : remoteEndpointOrigin({ url: record.url });
  return { label: redactSecrets({ input: record.label ?? id }, { redactPii: false }),
    target: redactSecrets({ input: target }, { redactPii: false }) };
}

function remoteEndpointOrigin({ url }: { url: string | null }, _optional = {}): string {
  if (url === null) return 'Remote endpoint unavailable.';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : 'Remote endpoint unavailable.';
  } catch {
    return 'Remote endpoint unavailable.';
  }
}

/** New permissions must name tools actually advertised by this exact admitted endpoint.
 * Existing grants may still be removed or disabled without starting optional remote discovery.
 * `refusal` replaces the default copy when the caller knows a more precise, value-free cause.
 * @throws ToolInputError before a card/write if any new name is absent from the identity-bound cache.
 * @complexity O(a+w+t) in bounded proposed/current lists and the existing cached tool names; no I/O.
 */
function requireKnownMcpAccess({ routeDeps, record, previous, access }: {
  routeDeps: ExternalMcpToolDeps; record: ExternalMcpServerRecord;
  previous: { enabled: boolean; allowedToolNames: readonly string[]; writeAllowedToolNames: readonly string[] };
  access: { enabled: boolean; allowedToolNames: readonly string[]; writeAllowedToolNames: readonly string[] };
}, { refusal }: { refusal?: string } = {}): void {
  const enabling = !previous.enabled && access.enabled;
  const newNames = enabling ? [...access.allowedToolNames, ...access.writeAllowedToolNames]
    : [...access.allowedToolNames.filter(name => !previous.allowedToolNames.includes(name)),
      ...access.writeAllowedToolNames.filter(name => !previous.writeAllowedToolNames.includes(name))];
  if (newNames.length === 0) return;
  const known = routeDeps.externalMcpKnownToolNames?.({ serverId: record.serverId, admissionRevision: externalMcpAccessSnapshot({ record }).admissionRevision });
  const names = new Set(known ?? []);
  if (!newNames.every(name => names.has(name))) throw new ToolInputError({ message: refusal ?? `The '${record.serverId}' connection has no verified tool listing for this proposed access. Open Settings → External MCP, turn on this connection there if it is off, then choose its allowed tools in Tools after it connects. Nothing was changed.` });
}

/** Configuration cards carry the same fresh person and management checks as access cards.
 * @complexity O(1); two existing authorization reads per card phase. */
export async function requireMcpSaveApprover({ routeDeps, surfaces, principalId, id }: {
  routeDeps: ExternalMcpToolDeps; surfaces: ChatDeleteSurfaceDeps; principalId: string; id: string;
}): Promise<void> {
  await authorizeMcpAccess({ routeDeps, principalId, id });
  if (!surfaces.assertAccessApprover) throw new ToolInputError({ message: 'This chat cannot verify the person approving the connection. Reopen the chat in your signed-in admin session. Nothing was saved.' });
  await surfaces.assertAccessApprover({ toolId: EXTERNAL_MCP_SAVE_TOOL_ID, principalId });
}

/** Check fixed grants against the proposed source identity, including a human-edited target.
 * @complexity O(a+w+t) in bounded tool lists; no I/O or credential discovery. */
export function requireKnownMcpSave({ routeDeps, record, input }: {
  routeDeps: ExternalMcpToolDeps; record: ExternalMcpServerRecord | null; input: SaveExternalMcpServerInput;
}): void {
  const access = { enabled: input.enabled, allowedToolNames: parseAllowedToolNames({ raw: input.allowedToolNames }), writeAllowedToolNames: parseWriteAllowedToolNames({ raw: input.writeAllowedToolNames }) };
  if (!record) {
    if (access.allowedToolNames.length + access.writeAllowedToolNames.length > 0) throw new ExternalMcpValidationError('This new connection has no verified tool listing. Save the connection with no allowed tools, then choose its allowed tools in Settings → External MCP after it connects. Nothing was saved.', 'allowedToolNames');
    return;
  }
  const { target, previous, refusal } = mcpSaveBasis({ record, input });
  requireKnownMcpAccess({ routeDeps, record: target, previous, access }, refusal === undefined ? {} : { refusal });
}

/** The identity and prior grants a save's proposed access is checked against: the saved row when the
 * target is unchanged, or the edited target with no carried-over grants when the person changed it.
 * @complexity O(b) in bounded command/argument bytes plus one strict grant parse; no I/O. */
function mcpSaveBasis({ record, input }: { record: ExternalMcpServerRecord; input: SaveExternalMcpServerInput }, _optional = {}): {
  target: ExternalMcpServerRecord; refusal?: string;
  previous: { enabled: boolean; allowedToolNames: readonly string[]; writeAllowedToolNames: readonly string[] };
} {
  const candidate = mcpSaveTarget({ record, input });
  if (!mcpSaveTargetChanged({ record, candidate })) return { target: record, previous: { enabled: record.enabled, ...readExternalMcpToolGrants(record, { strict: true }) } };
  // Fixed copy per transport: the person edited this field, and its submitted value can hold a
  // credential (a capability URL, a token argument), so the refusal names the field, never the value.
  return { target: candidate, previous: { enabled: false, allowedToolNames: [], writeAllowedToolNames: [] },
    refusal: candidate.transport === 'stdio' ? CHANGED_COMMAND_REFUSAL : CHANGED_ADDRESS_REFUSAL };
}

/** Whether the edited form points at a different program or address than the saved row.
 * @complexity O(b) in bounded command/argument bytes; no I/O. */
function mcpSaveTargetChanged({ record, candidate }: { record: ExternalMcpServerRecord; candidate: ExternalMcpServerRecord }, _optional = {}): boolean {
  // With `npx` or `node` the arguments choose the program, so they are the target too. Credentials are not.
  const stdioArgsChanged = candidate.transport === 'stdio' && candidate.args !== (record.args ?? '[]');
  return candidate.url !== record.url || candidate.command !== record.command || stdioArgsChanged;
}

const CHANGED_ADDRESS_REFUSAL = 'The connection address in this form differs from the saved one, so its allowed tools cannot carry over. Keep the saved address, or save the new address with no allowed tools and choose them after it connects. Nothing was saved.';
const CHANGED_COMMAND_REFUSAL = 'The command or arguments in this form differ from the saved ones, so its allowed tools cannot carry over. Keep the saved command and arguments, or save the new ones with no allowed tools and choose them after it connects. Nothing was saved.';

/** The connection and access a person reviewed on the card no longer match the stored row.
 * A dedicated identity, separate from bad input (`ToolInputError`/`ExternalMcpValidationError`) and
 * changed authority (`ForbiddenError`), so the card can ask for a new card rather than a field fix.
 * It carries no submitted form data: its only rendering is fixed copy. */
export class ExternalMcpSaveBasisChangedError extends Error {
  constructor() {
    super('The reviewed External MCP connection changed before it was saved.');
    this.name = 'ExternalMcpSaveBasisChangedError';
  }
}

/** Re-read the identity and access reviewed by the person before the configuration writer.
 * @complexity O(a+w) snapshot bytes; one existing source-row read, no credential unsealing. */
export async function currentMcpSaveRecord({ routeDeps, id, expected }: {
  routeDeps: ExternalMcpToolDeps; id: string; expected: ExternalMcpAccessSnapshot | null;
}): Promise<ExternalMcpServerRecord | null> {
  const current = await routeDeps.externalMcpServerRepo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: id });
  const snapshot = current ? externalMcpAccessSnapshot({ record: current }) : null;
  if (JSON.stringify(snapshot) !== JSON.stringify(expected)) throw new ExternalMcpSaveBasisChangedError();
  return current;
}

/** Match the store's normalized target without opening or retaining submitted credentials.
 * @complexity O(b) in bounded command/argument bytes; no I/O. */
function mcpSaveTarget({ record, input }: { record: ExternalMcpServerRecord; input: SaveExternalMcpServerInput }): ExternalMcpServerRecord {
  return { ...record, transport: input.transport,
    url: input.transport === 'streamable_http' ? input.url?.trim() ?? null : null,
    command: input.transport === 'stdio' ? input.command.trim() : null,
    args: JSON.stringify(parseArgs({ raw: input.args })), authMode: input.authMode ?? record.authMode };
}

/** Fixed access proposal through the same human-only exchange as other privilege changes.
 * Preparation reads one source; the accepted effect conditionally updates only its access columns.
 * @complexity O(a+w) bounded lists; two permission checks, one preview and one conditional update.
 */
export function externalMcpAccessHandler({ routeDeps, surfaces }: { routeDeps: ExternalMcpToolDeps; surfaces: ChatDeleteSurfaceDeps }): ToolHandler {
  return routeDeps.approvalToolHandler({ surfaces,
    prepare: async ({ ctx }) => {
      const input = requireInputRecord({ input: ctx.input });
      const id = requireString({ input, key: 'id' }).trim().toLowerCase();
      await authorizeMcpAccess({ routeDeps, principalId: ctx.principal.id, id });
      const record = await routeDeps.externalMcpServerRepo.findByServerId({ workspaceId: routeDeps.workspaceId, serverId: id });
      if (!record) throw new ToolInputError({ message: `The '${id}' connection no longer exists. Request its connection setup before changing access. Nothing was changed.` });
      const transport = optionalStringField({ input, key: 'transport' });
      if (transport !== undefined && transport !== record.transport) throw new ToolInputError({ message: `The '${id}' connection uses a different transport. Request its current configuration before changing access. Nothing was changed.` });
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new ToolInputError({ message: "'enabled' must be true or false. Nothing was changed." });
      const previous = { enabled: record.enabled, ...readExternalMcpToolGrants(record, { strict: true }) };
      const allowed = optionalStringField({ input, key: 'allowedToolNames' });
      const write = optionalStringField({ input, key: 'writeAllowedToolNames' });
      const access = { enabled: input.enabled as boolean | undefined ?? record.enabled,
        allowedToolNames: allowed === undefined ? previous.allowedToolNames : parseAllowedToolNames({ raw: allowed }),
        writeAllowedToolNames: write === undefined ? previous.writeAllowedToolNames : parseWriteAllowedToolNames({ raw: write }) };
      const allowedSet = new Set(access.allowedToolNames);
      if (access.writeAllowedToolNames.some(name => !allowedSet.has(name))) throw new ToolInputError({ message: 'Every tool allowed to write must also appear in allowedToolNames. Nothing was changed.' });
      requireKnownMcpAccess({ routeDeps, record, previous, access });
      return { id, ...externalMcpAccessSubject({ record, id }), expected: externalMcpAccessSnapshot({ record }), previous, access };
    },
    describe: ({ ctx, prepared }) => ({ toolId: EXTERNAL_MCP_SAVE_TOOL_ID, errorCode: 'EXTERNAL_MCP',
      title: 'Change this connection’s access?', description: 'Only the listed source and tool grants change. Stored credentials stay in place.',
      details: [{ label: 'Source target', value: prepared.target }], confirmLabel: 'Approve access', access: { resources: [{ id: prepared.id, label: prepared.label,
        scope: { personId: ctx.principal.id, siteId: routeDeps.workspaceId }, revision: prepared.expected.admissionRevision,
        previous: prepared.previous, proposed: prepared.access }] } }),
    run: async ({ ctx, prepared }) => {
      await authorizeMcpAccess({ routeDeps, principalId: ctx.principal.id, id: prepared.id });
      ctx.signal.throwIfAborted();
      await applyExternalMcpAccess({ repo: routeDeps.externalMcpServerRepo, clock: routeDeps.clock,
        workspaceId: routeDeps.workspaceId, serverId: prepared.id, expected: prepared.expected, access: prepared.access, principalId: ctx.principal.id });
      const lowers = !prepared.access.enabled || prepared.previous.allowedToolNames.some(name => !prepared.access.allowedToolNames.includes(name)) ||
        prepared.previous.writeAllowedToolNames.some(name => !prepared.access.writeAllowedToolNames.includes(name));
      if (lowers) await routeDeps.notifyExternalMcpRosterChanged({ lowered: { serverIds: [prepared.id] } });
      else void routeDeps.notifyExternalMcpRosterChanged();
      return { saved: true, server: { serverId: prepared.id, ...prepared.access } };
    },
  }, { flag: 'saved' });
}

