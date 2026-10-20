/**
 * @file The admin-surface `deliveryBindings` port: a plugin's destination screen lists, saves and
 * removes the workspace's form-delivery bindings for the delivery adapters its surface declares, so an
 * admin no longer copies a destination's config by hand.
 *
 * Why the checks sit here and not only in the host: the surface's `deliveryAdapters` and `connections`
 * are the shipped, digest-checked allowlists. So before the host sees a call, the session refuses an
 * adapter or connection the surface did not declare, a config that is not bounded plain JSON or that
 * mentions a token the plugin obtained (`./settings-value.ts`, the same check as plugin state), and any
 * binding id that is not one of the surface's own bindings (so another adapter's binding can be neither
 * overwritten nor removed); and it filters and re-shapes what the host lists. The host still owns
 * ownership itself (that the adapter ids are ones this plugin contributes), storage, the binding ids,
 * and mapping a declared connection id to its own connection for the scope's plugin and workspace.
 */
import type { AgentPluginCapabilityGate, AgentPluginStateValue } from '../lifecycle/tools/capabilities.js';
import { storedStateValue } from './settings-value.js';

/** One binding as a surface sees it: plugin-owned config, the plugin's own connection id (never a ref). */
export interface AdminSurfaceDeliveryBinding {
  readonly bindingId: string;
  readonly adapterId: string;
  readonly connectionId: string;
  readonly enabled: boolean;
  /** Absent = every form; [] = no form (the form-delivery binding rule). */
  readonly formIds?: readonly string[];
  /** Adapter-owned, non-secret configuration. */
  readonly config: Readonly<Record<string, AgentPluginStateValue>>;
}

/** What `save` takes: a new binding (the host assigns its id) or, with `bindingId`, one of the surface's own. */
export type AdminSurfaceDeliveryBindingDraft = Omit<AdminSurfaceDeliveryBinding, 'bindingId'> & { readonly bindingId?: string };

/**
 * The port. The host implements it scoped to the call's plugin and workspace, listing only the plugin's
 * own adapters' bindings; the session hands the plugin the same interface, checked.
 */
export interface AdminSurfaceDeliveryBindings {
  list(required?: Record<string, never>, optional?: Record<string, never>): Promise<readonly AdminSurfaceDeliveryBinding[]>;
  save(required: AdminSurfaceDeliveryBindingDraft, optional?: Record<string, never>): Promise<AdminSurfaceDeliveryBinding>;
  remove(required: { readonly bindingId: string }, optional?: Record<string, never>): Promise<void>;
}

export const DELIVERY_BINDING_WITHHELD_MESSAGE = 'A delivery binding held a connection credential, so it was withheld. Remove it and save it again.';
const FORM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_FORM_IDS = 64;

/** Names in messages come from plugin code: cut them so a message stays a message. */
const named = (value: unknown) => String(value).slice(0, 64);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

interface Allowlists { readonly adapterIds: readonly string[]; readonly connectionIds: readonly string[] }

function checkedFormIds(formIds: unknown): readonly string[] {
  const valid = Array.isArray(formIds) && formIds.length <= MAX_FORM_IDS
    && formIds.every((id, index) => typeof id === 'string' && FORM_ID_PATTERN.test(id) && formIds.indexOf(id) === index);
  if (!valid) throw new Error(`formIds must be at most ${MAX_FORM_IDS} unique short form ids.`);
  return [...(formIds as string[])];
}

function checkedConfig(gate: AgentPluginCapabilityGate, config: unknown): AdminSurfaceDeliveryBinding['config'] {
  if (!isRecord(config)) throw new Error("A delivery binding's config must be a JSON object.");
  return storedStateValue({ gate, value: config }) as AdminSurfaceDeliveryBinding['config'];
}

/** The draft the host receives: only the known fields, each checked, the config a stored copy. @complexity O(f + n) form ids plus config size. */
function checkedDraft(gate: AgentPluginCapabilityGate, allow: Allowlists, draft: unknown): AdminSurfaceDeliveryBindingDraft {
  if (!isRecord(draft)) throw new Error('A delivery binding must be an object.');
  const { bindingId, adapterId, connectionId, enabled, formIds, config } = draft;
  if (!allow.adapterIds.includes(adapterId as string)) throw new Error(`This admin surface does not declare delivery adapter '${named(adapterId)}', so its handlers cannot manage its bindings. Declare it in the surface's deliveryAdapters.`);
  if (!allow.connectionIds.includes(connectionId as string)) throw new Error(`Delivery bindings may only use this surface's declared connections; '${named(connectionId)}' is not one of them.`);
  if (typeof enabled !== 'boolean') throw new Error('A delivery binding needs enabled: true or false.');
  return {
    ...(bindingId !== undefined && { bindingId: bindingId as string }),
    adapterId: adapterId as string, connectionId: connectionId as string, enabled,
    ...(formIds !== undefined && { formIds: checkedFormIds(formIds) }),
    config: checkedConfig(gate, config),
  };
}

/** The port shape, whatever else the host's object carried (a connection ref), refused when it mentions an obtained token. */
function toBinding(gate: AgentPluginCapabilityGate, binding: AdminSurfaceDeliveryBinding): AdminSurfaceDeliveryBinding {
  const { bindingId, adapterId, connectionId, enabled, formIds, config } = binding;
  const shaped = { bindingId, adapterId, connectionId, enabled, ...(formIds !== undefined && { formIds: [...formIds] }), config };
  if (gate.mentionsToken({ value: shaped })) throw new Error(DELIVERY_BINDING_WITHHELD_MESSAGE);
  return shaped;
}

/**
 * Wraps the host's port for one admin-surface call.
 * @param required.gate - The call's capability gate (revocation and token scans).
 * @param required.host - The host's port, already scoped to the plugin and workspace.
 * @param required.adapterIds - The surface's declared delivery adapters.
 * @param required.connectionIds - The surface's declared connection ids.
 * @param optional.actorId - The signed-in admin; every call is refused without one.
 * @returns The checked port.
 * @complexity Each call is one host list (plus one save or remove), O(b) over the listed bindings.
 */
export function guardDeliveryBindings(
  required: { readonly gate: AgentPluginCapabilityGate; readonly host: AdminSurfaceDeliveryBindings } & Allowlists,
  // `| undefined`: the session forwards its own optional actor as is.
  optional: { readonly actorId?: string | undefined } = {},
): AdminSurfaceDeliveryBindings {
  const { gate, host } = required;
  const forActor = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => gate.guard(async (...args: A) => {
    if (optional.actorId === undefined) throw new Error('Delivery settings need a signed-in admin. Open the surface from an authenticated admin page and retry.');
    return call(...args);
  });
  const ours = async () => (await host.list()).filter((binding) => required.adapterIds.includes(binding.adapterId));
  /** The id when it names one of this surface's bindings; a plugin never reaches another adapter's binding. */
  const ownId = async (bindingId: unknown) => {
    if (!(await ours()).some((binding) => binding.bindingId === bindingId)) throw new Error(`No delivery binding '${named(bindingId)}' belongs to this surface's delivery adapters; list the bindings and retry.`);
    return bindingId as string;
  };
  return Object.freeze({
    list: forActor(async () => (await ours()).map((binding) => toBinding(gate, binding))),
    save: forActor(async (draft: AdminSurfaceDeliveryBindingDraft) => {
      const checked = checkedDraft(gate, required, draft);
      if (checked.bindingId !== undefined) await ownId(checked.bindingId);
      return toBinding(gate, await host.save(checked));
    }),
    remove: forActor(async ({ bindingId }: { readonly bindingId: string }) => { await host.remove({ bindingId: await ownId(bindingId) }); }),
  });
}
