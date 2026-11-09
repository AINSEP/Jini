/**
 * @file `createPluginInvocationBinding()` — the per-load backing for a plugin's capability-scoped
 * SDK (`content.read`, `content.extend`, `addFilter`), shared by every place that runs a plugin's
 * `setup()`: the host's in-process enable path and the Tier-2 worker (`../worker/run-call.ts`).
 * One implementation, so a Tier-2 plugin sees exactly the SDK semantics a Tier-3 plugin does
 * (ADR-024 §3: the ABI is the same; only where the code runs differs).
 *
 * `content.read`/`content.extend` are bound to the filter invocation that is currently running
 * (AsyncLocalStorage), never to load time: a plugin that calls them from `setup()` or from a timer
 * after its filter returned gets a named error instead of another save's entry.
 *
 * Transported from the host's `invocation-core-deps.ts` (extract-s6 L1b); the only changed
 * expressions are the host SDK's beforeSave hook id (now the required `beforeSaveHook`) and the
 * entry/filter types (now the plugin-domain envelope from `../ports.ts`).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { BeforeSaveFilter, ContentEntryDraft } from "../ports.js";
import type { CapabilityScopedSdkCoreDeps } from "../capability-sdk.js";

interface InvocationState {
  readonly entry: Readonly<ContentEntryDraft>;
  readonly writes: Record<string, string | number | boolean>;
}

/**
 * @agent-note Second-host rule: `beforeSaveHook` is YOUR SDK's beforeSave hook id (the same string
 * as `PluginSdkBinding.beforeSaveHook`); the plugin package never chooses it. `declaredHooks` is the
 * already-validated manifest `hooks` list for this one load. Build one binding per plugin load
 * (per worker call on Tier 2) — never share one across loads.
 */
export interface CreatePluginInvocationBindingRequired {
  readonly pluginId: string;
  /** The manifest's declared `hooks` — `addFilter` refuses any hook not listed here. */
  readonly declaredHooks: readonly string[];
  /** The host SDK's beforeSave hook id; the only hook `addFilter` accepts here. */
  readonly beforeSaveHook: string;
}

export type CreatePluginInvocationBindingOptional = Record<string, never>;

/**
 * @agent-note Second-host rule: hand `coreDeps` to `loadPlugin()`/`buildCapabilityScopedSdk()` for
 * the SAME load, then read `capturedFilter()` only after `setup()` resolved. The wrapped filter
 * runs the plugin filter inside this load's one AsyncLocalStorage; the host adapts its own rich
 * SDK entry/patch types onto this plain envelope and keeps every host payload field (the entry
 * object is passed through untouched).
 */
export interface PluginInvocationBinding {
  /** Hand to `buildCapabilityScopedSdk()` (via `loadPlugin()`'s `coreDeps`). */
  readonly coreDeps: CapabilityScopedSdkCoreDeps;
  /** The beforeSave filter `setup()` attached, wrapped so `content.read`/`content.extend` work
   * while it runs; `null` until (or unless) setup attaches one. */
  capturedFilter(): BeforeSaveFilter | null;
}

/**
 * Builds one plugin load's SDK backing plus the slot its `setup()` fills with a beforeSave filter.
 *
 * @agent-note Invariants a second host relies on: ONE AsyncLocalStorage per load; `content.read`
 * and `content.extend` work only inside the running filter (outside it they throw a named error);
 * exactly one filter, and only for the declared `beforeSaveHook`; extend writes merge UNDER the
 * filter's returned keys (returned keys win); a non-object return passes through untouched.
 * Nothing here writes or persists — the host's hook registry owns save, preview and quarantine.
 * @throws Nothing at build time. The returned handles throw when used outside a running filter,
 *   when an undeclared hook is attached, or when a second beforeSave filter is attached.
 * @complexity O(1) per call; a wrapped filter adds O(extend-write count) to merge writes.
 * @example createPluginInvocationBinding({ pluginId, declaredHooks: manifest.hooks, beforeSaveHook: binding.beforeSaveHook }, {})
 */
export function createPluginInvocationBinding(
  required: CreatePluginInvocationBindingRequired,
  _optional: CreatePluginInvocationBindingOptional = {},
): PluginInvocationBinding {
  const { pluginId, declaredHooks, beforeSaveHook } = required;
  const invocation = new AsyncLocalStorage<InvocationState>();
  let capturedFilter: BeforeSaveFilter | null = null;

  const coreDeps: CapabilityScopedSdkCoreDeps = {
    getCurrentEntry(): Readonly<ContentEntryDraft> {
      const state = invocation.getStore();
      if (!state) throw new Error(`plugin '${pluginId}' called content.read outside a beforeSave hook`);
      return state.entry;
    },
    writeExtField(field: string, value: string | number | boolean): void {
      const state = invocation.getStore();
      if (!state) throw new Error(`plugin '${pluginId}' called content.extend outside a beforeSave hook`);
      state.writes[field] = value;
    },
    attachFilter(hookName: string, filter: BeforeSaveFilter): void {
      if (hookName !== beforeSaveHook || !declaredHooks.includes(hookName)) {
        throw new Error(`plugin '${pluginId}' attempted to attach undeclared hook '${String(hookName)}'`);
      }
      if (capturedFilter) {
        throw new Error(`plugin '${pluginId}' attempted to attach more than one beforeSave filter`);
      }

      capturedFilter = async (entry, ctx) => {
        const state: InvocationState = { entry, writes: {} };
        return invocation.run(state, async () => {
          const returned = await filter(entry, ctx);
          if (Object.keys(state.writes).length === 0) return returned;
          if (typeof returned !== "object" || returned === null || Array.isArray(returned)) return returned;
          return { ...state.writes, ...returned };
        });
      };
    },
  };

  return { coreDeps, capturedFilter: () => capturedFilter };
}
