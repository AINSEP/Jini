/**
 * @module agent-plugin-preflight
 *
 * `POST /internal/agent-plugin-preflight` as a server-framework-neutral `defineJsonRoute` spec the
 * host mounts. Three body shapes share the path:
 *
 * | body                                          | response                                       |
 * |-----------------------------------------------|------------------------------------------------|
 * | `{ runId }`                                   | `{ prefix, refusalPrefix, pluginIds }` (legacy)|
 * | `{ op: 'offer', runId }`                      | `{ prefix, refusalPrefix, pluginIds, offer }`  |
 * | `{ op: 'commit', runId, offerId, deliveredIds }` | `{ pluginIds }`                             |
 *
 * Identity never comes from the body: the host supplies authentication, the live-run lookup for the
 * authenticated principal and attempt, abort handling, and the controller calls behind the injected
 * deps. The only body-derived values ever dispatched are `runId`, `offerId`, and `deliveredIds`, so any
 * other field — `principalId`, `attempt`, `workspaceId`, anything — is refused with a 400 instead of
 * being silently ignored, and a caller cannot mistake an ignored field for an honored one.
 */
import { defineJsonRoute, err, ok, validationError, type Result } from '@jini-ai/core/contracts/server';
import type { AgentPluginGuidanceOffer } from '@jini-ai/core/contracts/site/daemon';

export const AGENT_PLUGIN_PREFLIGHT_ROUTE_PATH = '/internal/agent-plugin-preflight';

/** The legacy (pre-offer) preflight answer, unchanged on the wire. */
export type AgentPluginPreflightPrefix = {
  readonly prefix: string;
  readonly refusalPrefix: string;
  readonly pluginIds: readonly string[];
};

/** What `prepare` resolves; in `'offer'` mode `prefix` is pinned-only and `offer` carries the optional guidance. */
export type AgentPluginPreflightPrepared = AgentPluginPreflightPrefix & { readonly offer?: AgentPluginGuidanceOffer | null };
export type AgentPluginPreflightOfferResponse = AgentPluginPreflightPrefix & { readonly offer: AgentPluginGuidanceOffer | null };
export type AgentPluginPreflightCommitResponse = { readonly pluginIds: readonly string[] };
export type AgentPluginPreflightResponse = AgentPluginPreflightPrefix | AgentPluginPreflightOfferResponse | AgentPluginPreflightCommitResponse;

/** Narrow host port; the host resolves auth, the live run, and the attempt behind each call. */
export interface AgentPluginPreflightRouteDeps {
  prepare(required: { runId: string; mode: 'legacy' | 'offer' }, optional?: { signal?: AbortSignal }): Promise<Result<AgentPluginPreflightPrepared>>;
  commit(required: { runId: string; offerId: string; deliveredIds: readonly string[] }, optional?: { signal?: AbortSignal }): Promise<Result<AgentPluginPreflightCommitResponse>>;
}

export type AgentPluginPreflightInput =
  | { readonly op: 'legacy'; readonly runId: string }
  | { readonly op: 'offer'; readonly runId: string }
  | { readonly op: 'commit'; readonly runId: string; readonly offerId: string; readonly deliveredIds: readonly string[] };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_DELIVERED_IDS = 256;
const ALLOWED_KEYS = { legacy: ['runId'], offer: ['op', 'runId'], commit: ['op', 'runId', 'offerId', 'deliveredIds'] } as const;

const refuse = (message: string): Result<never> => err({ error: validationError({ message }) });
const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);

function asRecord({ value }: { readonly value: unknown }, _optional = {}): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function opOf({ body }: { readonly body: Record<string, unknown> }, _optional = {}): keyof typeof ALLOWED_KEYS | null {
  if (!('op' in body)) return 'legacy';
  return body.op === 'offer' || body.op === 'commit' ? body.op : null;
}

function parseDeliveredIds({ value }: { readonly value: unknown }, _optional = {}): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DELIVERED_IDS || !value.every(isId)) return null;
  return new Set(value).size === value.length ? value : null;
}

/** Parses one preflight body; every refusal is a plain-words 400 that echoes nothing back. */
export function parseAgentPluginPreflightBody({ body }: { readonly body: unknown }, _optional = {}): Result<AgentPluginPreflightInput> {
  const record = asRecord({ value: body });
  if (record === null) return refuse('Preflight request body must be an object.');
  const op = opOf({ body: record });
  if (op === null) return refuse('Preflight operation is not recognised.');
  const allowed: readonly string[] = ALLOWED_KEYS[op];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return refuse('Preflight request contains fields that are not accepted.');
  if (!isId(record.runId)) return refuse('Preflight run id is missing or malformed.');
  if (op !== 'commit') return ok({ value: { op, runId: record.runId } });
  if (!isId(record.offerId)) return refuse('Preflight offer id is missing or malformed.');
  const deliveredIds = parseDeliveredIds({ value: record.deliveredIds });
  if (deliveredIds === null) return refuse('Delivered plugin ids must be a list of distinct, well-formed ids.');
  return ok({ value: { op, runId: record.runId, offerId: record.offerId, deliveredIds } });
}

async function handlePreflight({ input, deps }: { readonly input: AgentPluginPreflightInput; readonly deps: AgentPluginPreflightRouteDeps }, { signal }: { readonly signal?: AbortSignal | undefined } = {}): Promise<Result<AgentPluginPreflightResponse>> {
  const callOptions = signal === undefined ? {} : { signal };
  if (input.op === 'commit') {
    const committed = await deps.commit({ runId: input.runId, offerId: input.offerId, deliveredIds: input.deliveredIds }, callOptions);
    return committed.ok ? ok({ value: { pluginIds: committed.value.pluginIds } }) : committed;
  }
  const prepared = await deps.prepare({ runId: input.runId, mode: input.op }, callOptions);
  if (!prepared.ok) return prepared;
  const { prefix, refusalPrefix, pluginIds } = prepared.value;
  // The legacy shape stays exactly three fields: an offer is never leaked to a pre-offer caller.
  if (input.op === 'legacy') return ok({ value: { prefix, refusalPrefix, pluginIds } });
  return ok({ value: { prefix, refusalPrefix, pluginIds, offer: prepared.value.offer ?? null } });
}

export const agentPluginPreflightRoute = defineJsonRoute<AgentPluginPreflightInput, AgentPluginPreflightResponse, AgentPluginPreflightRouteDeps>({
  method: 'post',
  path: AGENT_PLUGIN_PREFLIGHT_ROUTE_PATH,
  parse: (raw) => parseAgentPluginPreflightBody({ body: raw.body }),
  handle: ({ input, deps }, { signal } = {}) => handlePreflight({ input, deps }, { signal }),
});
