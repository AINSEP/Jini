import { AdminSurfaceActionError, type AdminSurfaceDeliveryBinding, type AdminSurfaceDeliveryBindingDraft, type AdminSurfaceDeliveryBindings } from "../../admin-surfaces/index.js";
import type { FormDeliveryBinding } from "@jini-ai/core/contracts/site/cms-forms";
import { ValueValidationFailedError } from "@jini-ai/core/settings";

/**
 * @file The host's `deliveryBindings` port for plugin admin-surface handlers (Jini's
 * `AdminSurfaceDeliveryBindings`): a plugin's destination screen lists, saves and removes the
 * site's form-delivery bindings for the adapters THIS plugin contributes, so an admin no longer
 * copies a destination's config by hand.
 *
 * Why the host re-checks what Jini's session already checked: the session knows only the surface's
 * declared adapter and connection ids; only the host knows which adapters the calling plugin really
 * contributes (`jini-form-destinations.json`) and which connections it declares in this workspace.
 * And the session's ownership check is a separate `list` before the `save`/`remove`, so ownership is
 * re-read here inside the write itself (another writer may have changed the setting in between).
 *
 * Bindings are written through the forms build's binding owner (`core.forms/deliveryBindings`, via
 * the settings chokepoint), with the signed-in admin as the caller: the same validation and the same
 * `settings.workspace.write` authorization every other writer gets. No second store. The plugin
 * sees its own connection id, never the stored connection ref, and names forms by slug (the only
 * form identity a destination ever receives: the frozen job carries `form.slug`); the stored binding
 * keeps the forms' row ids, which is what delivery planning matches.
 */

/** Read and write of the site's `core.forms/deliveryBindings` list (the forms build owns both). */
export interface FormDeliveryBindingsStore {
  isConflict(required: { readonly error: unknown }, optional?: Record<string, never>): boolean;
  read(required: { readonly workspaceId: string }): Promise<readonly FormDeliveryBinding[]>;
  /** Atomically refuses a stale expectedValue with FormDeliveryBindingsConflictError. */
  write(required: { readonly workspaceId: string; readonly callerPrincipalId: string; readonly value: readonly FormDeliveryBinding[]; readonly expectedValue: readonly FormDeliveryBinding[] }): Promise<void>;
}

export interface SurfaceDeliveryBindingsDeps {
  /** The one workspace this site serves; any other scope owns nothing here. */
  readonly siteWorkspaceId: string;
  /** Connection ids the plugin declares in this workspace (active plugins only). */
  readonly declaredConnectionIds: (required: { readonly pluginId: string }) => Promise<readonly string[]>;
  /** Form-destination adapter ids the plugin contributes in the workspace (active plugins only). */
  readonly contributedAdapterIds: (required: { readonly workspaceId: string; readonly pluginId: string }) => Promise<readonly string[]>;
  readonly forms: { list(required: { readonly workspaceId: string }): Promise<readonly { readonly id: string; readonly slug: string }[]> };
  readonly bindings: FormDeliveryBindingsStore;
  readonly newBindingId: () => string;
  /** The stored connection ref of one plugin connection (the host binds its api-connection key deriver). */
  readonly deriveConnectionRef: (required: { readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string }) => string;
}

/** What one call knows about ownership, read fresh per call. */
interface Ownership {
  readonly all: readonly FormDeliveryBinding[];
  readonly adapterIds: ReadonlySet<string>;
  readonly refByConnectionId: ReadonlyMap<string, string>;
  readonly connectionIdByRef: ReadonlyMap<string, string>;
  readonly slugByFormId: ReadonlyMap<string, string>;
  readonly formIdBySlug: ReadonlyMap<string, string>;
}

const NOTHING_OWNED: Ownership = { all: [], adapterIds: new Set(), refByConnectionId: new Map(), connectionIdByRef: new Map(), slugByFormId: new Map(), formIdBySlug: new Map() };

/** Names in messages come from plugin code: cut them so a message stays a message. */
const named = ({ value }: { value: string }, _optional: Record<string, never> = {}) => JSON.stringify(value.slice(0, 64));

function refusal({ code, message }: { code: string; message: string }, _optional: Record<string, never> = {}): AdminSurfaceActionError {
  return new AdminSurfaceActionError({ code, message });
}

/**
 * This plugin's stored bindings: the adapter is one the plugin contributes and the ref one of the
 * plugin's connections (a binding the plugin cannot name by connection id is not its to manage).
 * @complexity O(b).
 */
function ownEntries(ownership: Ownership): { readonly binding: FormDeliveryBinding; readonly index: number; readonly connectionId: string }[] {
  return ownership.all.flatMap((binding, index) => {
    const connectionId = ownership.adapterIds.has(binding.adapterId) ? ownership.connectionIdByRef.get(binding.connectionRef) : undefined;
    return connectionId === undefined ? [] : [{ binding, index, connectionId }];
  });
}

/**
 * The surface's view of a stored binding: connection id instead of ref, slugs instead of form ids
 * (an id whose form is gone is left out).
 * @complexity O(f) form ids.
 */
function toView({ ownership, binding, connectionId }: { ownership: Ownership; binding: FormDeliveryBinding; connectionId: string }, _optional: Record<string, never> = {}): AdminSurfaceDeliveryBinding {
  // A stored binding without `formIds` delivers every form (the forms build's meaning); the port
  // states that explicitly, so the plugin never has to infer it from a missing field.
  const forms = binding.formIds === undefined ? { allForms: true as const } : { formIds: binding.formIds.flatMap((formId) => ownership.slugByFormId.get(formId) ?? []) };
  return {
    bindingId: binding.bindingId, adapterId: binding.adapterId, connectionId,
    enabled: binding.enabled, ...forms,
    // Stored config passed the binding owner's JSON validation and Jini's plain-JSON check on save.
    config: binding.config as AdminSurfaceDeliveryBinding["config"],
  };
}

/** Slugs → this site's form row ids. @throws AdminSurfaceActionError `form-not-found`. @complexity O(f). */
function storedFormIds(ownership: Ownership, slugs: readonly string[]): string[] {
  return slugs.map((slug) => {
    const formId = ownership.formIdBySlug.get(slug);
    if (formId === undefined) throw refusal({ code: "form-not-found", message: `No form with the short name ${named({ value: slug })} exists on this site. Check the form's short name and save again.` });
    return formId;
  });
}

/**
 * The binding to store for a draft the plugin owns.
 * @throws AdminSurfaceActionError `adapter-not-owned`, `connection-not-declared` or `form-not-found`.
 * @complexity O(f) form ids.
 */
function toStored({ ownership, draft, bindingId }: { ownership: Ownership; draft: AdminSurfaceDeliveryBindingDraft; bindingId: string }, _optional: Record<string, never> = {}): FormDeliveryBinding {
  if (!ownership.adapterIds.has(draft.adapterId)) throw refusal({ code: "adapter-not-owned", message: `This plugin does not provide the delivery adapter ${named({ value: draft.adapterId })} here, so it cannot save its bindings.` });
  const connectionRef = ownership.refByConnectionId.get(draft.connectionId);
  if (connectionRef === undefined) throw refusal({ code: "connection-not-declared", message: `This plugin has no connection ${named({ value: draft.connectionId })} here. Reopen the plugin's settings from this site's admin and retry.` });
  return {
    bindingId, adapterId: draft.adapterId, connectionRef, enabled: draft.enabled,
    // `allForms: true` is stored as no `formIds`, which the forms build reads as every form.
    ...(draft.allForms === true ? {} : { formIds: storedFormIds(ownership, draft.formIds) }),
    config: { ...draft.config },
  };
}

/**
 * `stored` keeping the form ids of `previous` this site's form list does not show (a trashed form):
 * the plugin only ever saw the visible slugs, so a re-save must not drop a form that comes back.
 * @complexity O(f) form ids.
 */
function keepHiddenFormIds({ ownership, stored, previous }: { ownership: Ownership; stored: FormDeliveryBinding; previous: FormDeliveryBinding | undefined }, _optional: Record<string, never> = {}): FormDeliveryBinding {
  if (stored.formIds === undefined || previous?.formIds === undefined) return stored;
  const formIds = stored.formIds;
  const hidden = previous.formIds.filter((formId) => !ownership.slugByFormId.has(formId) && !formIds.includes(formId));
  return hidden.length === 0 ? stored : { ...stored, formIds: [...formIds, ...hidden] };
}

/** The index of one of this plugin's stored bindings. @throws AdminSurfaceActionError `binding-not-found`. @complexity O(b). */
function ownIndex({ ownership, bindingId }: { ownership: Ownership; bindingId: string }, _optional: Record<string, never> = {}): number {
  const own = ownEntries(ownership).find((entry) => entry.binding.bindingId === bindingId);
  if (own === undefined) throw refusal({ code: "binding-not-found", message: `No delivery binding ${named({ value: bindingId })} belongs to this plugin here. List the bindings again and retry.` });
  return own.index;
}

type BindingScope = SurfaceDeliveryBindingsDeps & { readonly pluginId: string; readonly workspaceId: string; readonly principalId?: string };

/** @complexity O(b + c + a + forms), four reads in parallel. */
async function readOwnership(required: BindingScope): Promise<Ownership> {
  const { pluginId, workspaceId } = required;
  if (workspaceId !== required.siteWorkspaceId) return NOTHING_OWNED;
  const [all, adapterIds, connectionIds, forms] = await Promise.all([
    required.bindings.read({ workspaceId }), required.contributedAdapterIds({ workspaceId, pluginId }),
    required.declaredConnectionIds({ pluginId }), required.forms.list({ workspaceId }),
  ]);
  const refs = connectionIds.map((connectionId) => [connectionId, required.deriveConnectionRef({ workspaceId, pluginId, connectionId })] as const);
  return {
    all, adapterIds: new Set(adapterIds),
    refByConnectionId: new Map(refs), connectionIdByRef: new Map(refs.map(([connectionId, ref]) => [ref, connectionId])),
    slugByFormId: new Map(forms.map((form) => [form.id, form.slug])), formIdBySlug: new Map(forms.map((form) => [form.slug, form.id])),
  };
}

/**
 * Merges against fresh ownership and writes through the binding owner; one conflict retries the
 * whole ownership check, so a concurrent removal or ownership change cannot be undone.
 * Validation keeps its people-facing message; a second conflict asks the panel to refresh.
 * @complexity At most two ownership reads and guarded writes; O(b + f) merge time/space per try.
 */
async function updateBindings<T>(
  required: BindingScope,
  input: { callerPrincipalId: string; merge: (required: { owned: Ownership }, optional?: Record<string, never>) => { value: readonly FormDeliveryBinding[]; result: T } },
  optional: { retry?: boolean } = {},
): Promise<T> {
  const owned = await readOwnership(required);
  const { value, result } = input.merge({ owned });
  const { workspaceId } = required;
  try {
    await required.bindings.write({ workspaceId, callerPrincipalId: input.callerPrincipalId, value, expectedValue: owned.all });
    return result;
  } catch (error) {
    if (required.bindings.isConflict({ error })) {
      if (optional.retry !== false) return updateBindings(required, input, { retry: false });
      throw new AdminSurfaceActionError({ code: "delivery-binding-conflict", message: "Delivery settings changed in another panel. List the bindings again and retry your change." }, { cause: error });
    }
    if (!(error instanceof ValueValidationFailedError)) throw error;
    throw new AdminSurfaceActionError({ code: "delivery-binding-invalid", message: error.message }, { cause: error });
  }
}

/**
 * Builds the per-call port for one plugin, workspace and signed-in admin.
 * @param required.principalId - The admin the route authenticated; every call is refused without one,
 *   and every write is authorized for this principal by the settings chokepoint.
 * @complexity Each call: one bindings read, one connection and one adapter listing, one forms list,
 *   then O(b + f); `save` and `remove` add one guarded settings write and retry once on conflict.
 */
export function createSurfaceDeliveryBindings(
  required: BindingScope,
  _optional: Record<string, never> = {},
): AdminSurfaceDeliveryBindings {
  const { principalId } = required;

  function admin(): string {
    if (principalId === undefined) throw refusal({ code: "admin-required", message: "Delivery settings need a signed-in admin. Open the plugin's settings from this site's admin and retry." });
    return principalId;
  }

  return {
    async list() {
      admin();
      const owned = await readOwnership(required);
      return ownEntries(owned).map((entry) => toView({ ownership: owned, binding: entry.binding, connectionId: entry.connectionId }));
    },
    async save(draft) {
      const callerPrincipalId = admin();
      const bindingId = draft.bindingId ?? required.newBindingId();
      return updateBindings(required, { callerPrincipalId, merge: ({ owned }, _optional = {}) => {
        const replaced = draft.bindingId === undefined ? owned.all.length : ownIndex({ ownership: owned, bindingId: draft.bindingId });
        const stored = keepHiddenFormIds({ ownership: owned, stored: toStored({ ownership: owned, draft, bindingId }), previous: owned.all[replaced] });
        return { value: [...owned.all.slice(0, replaced), stored, ...owned.all.slice(replaced + 1)], result: toView({ ownership: owned, binding: stored, connectionId: draft.connectionId }) };
      } });
    },
    async remove({ bindingId }) {
      const callerPrincipalId = admin();
      return updateBindings(required, { callerPrincipalId, merge: ({ owned }, _optional = {}) => {
        const index = ownIndex({ ownership: owned, bindingId });
        return { value: owned.all.filter((_binding, at) => at !== index), result: undefined };
      } });
    },
  };
}
