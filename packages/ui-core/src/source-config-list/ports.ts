/**
 * The DI seam. Everything in this feature reaches transport only through
 * this interface — `dependencies.ts` is the one file allowed to bind a real
 * implementation. Host-injected adapters do the actual network calls; none
 * of the four origin sources' specific endpoints (the daemon's
 * `/api/mcp/servers`, OD's BYOK config endpoint, the plugin-marketplace
 * fetch, etc.) become part of this generic primitive.
 *
 * `refreshSource`/`setTrust`/`testSource` are optional on purpose: not every
 * source shape supports every action (the origin MCP-server shape has no
 * trust concept at all; a plugin marketplace has no per-item connection
 * test). The React layer derives which per-item actions to render from
 * which of these methods a host's port actually implements, rather than a
 * separate set of boolean feature flags a host would have to keep in sync.
 */
import type {
  AddSourceInput,
  AddSourceResult,
  SourceConfigItem,
  SourceFieldValues,
  SourceTestResult,
  SourceUpdateInput,
} from './types.js';

export interface SourceConfigPort<TSource extends SourceConfigItem = SourceConfigItem> {
  fetchSources(): Promise<TSource[]>;
  addSource(input: AddSourceInput): Promise<AddSourceResult<TSource>>;
  removeSource(id: string): Promise<boolean>;
  /** Optional: omit for a source shape with nothing to re-fetch (e.g. a static BYOK key entry). */
  refreshSource?(id: string): Promise<TSource | null>;
  /** Optional: omit for a source shape with no trust/authorization-level concept. */
  setTrust?(id: string, trust: string): Promise<TSource | null>;
  /**
   * Optional: omit for a source shape with nothing editable after creation
   * (e.g. a static BYOK key entry). Ported in spirit from
   * `McpClientSection.tsx`'s `McpRow` — the origin's own enable/disable
   * toggle (`onChange({ enabled })`) and expand-to-edit label/field inputs
   * (`onChange({ label })`, per-field `onChange`), generalized as a single
   * partial-patch method rather than one method per editable property, so a
   * host with more than `label`/`enabled`/`fields` to patch doesn't need a
   * growing list of port methods. The React layer derives whether to render
   * ANY enable-toggle/edit affordance from whether this method exists at
   * all (`capabilities.canUpdate`), same "capability from port method
   * presence" pattern as `refreshSource`/`setTrust`/`testSource`.
   */
  updateSource?(id: string, patch: SourceUpdateInput): Promise<TSource | null>;
  /**
   * Optional: omit for a source shape with no connection-test concept.
   * `id` is `undefined` for the one case that has no persisted item yet at
   * all — testing the add-form's still-unsaved draft (the origin BYOK
   * `EntryShell.tsx`'s `testProviderInline`/`ByokConnectionTestControl`
   * "test before save" UX, which calls its test endpoint with the current
   * form field values directly, never an item id). `draft`, when supplied
   * alongside a real `id`, lets a host test unsaved edits to an
   * already-persisted item rather than only its last-saved values; a host
   * implementation reads `draft ?? <persisted fields for id>` itself.
   */
  testSource?(id: string | undefined, draft?: SourceFieldValues): Promise<SourceTestResult>;
}

export interface SourceConfigDependencies<TSource extends SourceConfigItem = SourceConfigItem> {
  port: SourceConfigPort<TSource>;
}
