/**
 * Generic "add a source by URL/key, set trust, list, per-item test/refresh/
 * remove" domain types. This shape recurs independently at least 4 times in
 * the origin product's `apps/web/src/components/` tree — see
 * `packages/ui/source-map.md`'s `features/source-config-list/` section for
 * full per-source provenance (which behaviors came from which file, and what
 * did NOT make it into this generic primitive).
 *
 * Deliberately generic over `TSource`: unlike `features/connectors/`'s fixed
 * `Connector` shape, each of the four origin sources (MCP servers, BYOK
 * provider keys, plugin marketplaces, onboarding BYOK setup) has genuinely
 * different fields — a URL here, an API key there, a model name elsewhere.
 * `SourceFieldSpec[]` is the host-supplied seam that lets one component
 * render all of them.
 */

/** Which UI control a field renders as. */
export type SourceFieldKind = 'text' | 'url' | 'password' | 'select' | 'textarea';

export interface SourceFieldOption {
  value: string;
  label: string;
}

/**
 * Host-supplied description of one editable field on a source (e.g. `url`,
 * `apiKey`, `model`, `command`). The generic primitive never hardcodes which
 * fields a "source" has — a host lists exactly the fields its own source
 * shape needs.
 */
export interface SourceFieldSpec {
  key: string;
  label: string;
  kind: SourceFieldKind;
  placeholder?: string;
  required?: boolean;
  /** Only read when `kind === 'select'`. */
  options?: SourceFieldOption[];
}

/** Arbitrary field values keyed by `SourceFieldSpec.key`. */
export type SourceFieldValues = Record<string, string>;

/**
 * A host-supplied trust/authorization-level option (e.g. the origin
 * `PluginsView.tsx`'s restricted/trusted/official, or a host's own
 * vocabulary entirely). Deliberately generic — this primitive never bakes in
 * one product's trust vocabulary; a host that has no trust concept at all
 * (the origin MCP-server shape has none) simply omits `trustOptions`.
 */
export interface SourceTrustOption {
  value: string;
  label: string;
}

export type SourceConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';

export interface SourceTestResult {
  ok: boolean;
  message?: string;
  latencyMs?: number;
}

/**
 * One configured source (an MCP server, a BYOK provider key, a plugin
 * marketplace, ...). `fields` carries whatever host-defined shape the
 * matching `SourceFieldSpec[]` describes.
 */
export interface SourceConfigItem {
  id: string;
  label?: string;
  trust?: string;
  enabled?: boolean;
  fields: SourceFieldValues;
  status?: SourceConnectionStatus;
  statusMessage?: string;
}

export type SourceActionKind = 'add' | 'remove' | 'refresh' | 'trust' | 'test' | 'update';

/**
 * Patch for an existing, already-persisted source's editable state —
 * `enabled` (on/off) and/or `label`/`fields` (expand-to-edit), ported in
 * spirit from `McpClientSection.tsx`'s `McpRow` (see `ports.ts`'s
 * `updateSource` doc comment). Every key is optional so a host UI can send
 * only what actually changed (e.g. just `{ enabled }` from the summary-row
 * toggle, without touching `label`/`fields`).
 */
export interface SourceUpdateInput {
  label?: string;
  enabled?: boolean;
  fields?: SourceFieldValues;
}

export interface SourceDraftIssue {
  field: string;
  message: string;
}

export interface SourceDraftValidation {
  ok: boolean;
  issues: SourceDraftIssue[];
}

export interface AddSourceInput {
  fields: SourceFieldValues;
  trust?: string;
}

export interface AddSourceResult<TSource extends SourceConfigItem = SourceConfigItem> {
  ok: boolean;
  source?: TSource;
  message?: string;
}
