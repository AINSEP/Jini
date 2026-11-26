import { SECRET_SHAPE_PATTERNS } from "@jini-ai/core";
import type { FormDeliveryBinding } from "../../forms/index.js";
import { SCOPE_BIT, ValueValidationFailedError, type EnsureSettingDefinitionsDeps, type EnsureSettingDefinitionsPort, type GetEffectivePort, type SetValueRequired, type SettingsRepoPort } from "@jini-ai/core/settings";

/**
 * @file The two site settings behind durable form delivery, on the existing settings ledger:
 * `core.forms/deliveryBindings` (which destinations receive each new submission) and
 * `core.forms/autoPull` (whether the serving app pulls static-site submissions on its own).
 *
 * A binding names an adapter (a form destination id) and a connection by reference only. The
 * secret behind `connectionRef` is resolved fresh on each delivery attempt and never copied into
 * the setting or the delivery job, which is why `config` refuses anything shaped like a secret.
 * Delivery copies what it sends: deleting a submission or a binding here later does NOT remove
 * copies a destination already received.
 *
 * Validation lives in one pure function, {@link parseFormDeliveryBindings}, used when the setting
 * is read for planning and by the host settings chokepoint (`site-title-write.ts`) through
 * {@link enforceFormDeliveryBindingsWrite}, which every write goes through: the typed write a later
 * admin or plugin UI calls (`form-delivery-write.ts`), the generic settings route and the tools. So
 * none of them can store a list planning would refuse, or a secret in `config`.
 */

const NAMESPACE = "core.forms";
const BINDINGS_KEY = "deliveryBindings";
const AUTO_PULL_KEY = "autoPull";

/** Caps that keep planning O(bindings × formIds) small and bounded per submission. */
const MAX_FORM_DELIVERY_BINDINGS = 100;
const MAX_FORM_DELIVERY_FORM_IDS = 1000;
const MAX_REFERENCE_LENGTH = 256;

const BINDING_FIELDS: ReadonlySet<string> = new Set(["bindingId", "adapterId", "connectionRef", "enabled", "formIds", "config"]);
/** Matched against a config key lowercased with separators removed (`api_key`, `API-Key` → `apikey`).
 *  `auth` and `pwd` match only as the whole key, so `author` or `authorName` stay usable. */
const SECRET_KEY = /token|secret|password|passphrase|apikey|privatekey|accesskey|credential|authorization|^auth$|^pwd$/;
/** Values that are credentials whatever their key is called: a Bearer Authorization header value, a
 *  JWT, a PEM private key, a URL carrying `user:pass@`. HTTP Basic is {@link isBasicCredential}. */
const SECRET_VALUES: readonly RegExp[] = [/^\s*bearer\s+\S/i, /\beyJ[\w-]+\.eyJ[\w-]+\./, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b[a-z][\w+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i];
const BASIC_VALUE = /^\s*basic\s+([A-Z0-9+/]+={0,2})\s*$/i;
const FIX_HINT = "Save the secret as a connection and point to it with connectionRef; config holds non-secret settings only.";

/**
 * Registers both definitions without replacing an owner's stored values. Delivery bindings default
 * to none; automatic pull defaults to ON (owner decision 2026-10-20).
 * @complexity O(1), two definitions.
 */
export function ensureFormDeliverySettings(
  required: { deps: EnsureSettingDefinitionsDeps & EnsureSettingDefinitionsPort; systemPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  return required.deps.ensureSettingDefinitions(required.deps, { namespace: NAMESPACE, systemPrincipalId: required.systemPrincipalId, definitions: [
    { key: BINDINGS_KEY, schema: { type: "json" }, defaultValue: [], scopes: SCOPE_BIT.workspace },
    { key: AUTO_PULL_KEY, schema: { type: "boolean" }, defaultValue: true, scopes: SCOPE_BIT.workspace },
  ] });
}

/**
 * Whether automatic pulls run for this site. Read fresh at every trigger; only an explicit
 * `false` turns them off, so an unregistered definition keeps the ON default.
 * @complexity One effective setting read.
 */
export async function readFormsAutoPull(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string } & GetEffectivePort,
  _optional: Record<string, never> = {},
): Promise<boolean> {
  const found = await required.getEffective({ deps: { repo: required.settingsRepo }, namespace: NAMESPACE, key: AUTO_PULL_KEY, scopeContext: { workspaceId: required.workspaceId } });
  return found?.value !== false;
}

/**
 * The site's validated bindings, read fresh when a submission is planned.
 * @throws ValueValidationFailedError when the stored value breaks a rule (the planning event then
 *   retries, so a fixed setting takes effect without losing the submission).
 * @complexity One effective read plus {@link parseFormDeliveryBindings}.
 */
export async function readFormDeliveryBindings(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string } & GetEffectivePort,
  _optional: Record<string, never> = {},
): Promise<FormDeliveryBinding[]> {
  const found = await required.getEffective({ deps: { repo: required.settingsRepo }, namespace: NAMESPACE, key: BINDINGS_KEY, scopeContext: { workspaceId: required.workspaceId } });
  return parseFormDeliveryBindings({ value: found?.value ?? [] });
}

/**
 * One settings write: a `core.forms.deliveryBindings` value is checked against every binding rule;
 * any other setting passes through unchanged. Pure. The value is stored as written: for JSON input
 * the parsed bindings hold exactly the same fields and values (unknown fields are refused, not
 * dropped), so there is no cleaned form to substitute.
 * @throws ValueValidationFailedError for any rule {@link parseFormDeliveryBindings} enforces.
 * @complexity {@link parseFormDeliveryBindings} for this setting, O(1) otherwise.
 */
export function enforceFormDeliveryBindingsWrite(input: SetValueRequired["input"]): SetValueRequired["input"] {
  if (input.namespace === NAMESPACE && input.key === BINDINGS_KEY) parseFormDeliveryBindings({ value: input.value });
  return input;
}

/**
 * Pure validator: returns fresh, cleaned binding objects or throws naming the first rule broken.
 * Rules: a list of at most {@link MAX_FORM_DELIVERY_BINDINGS}; each binding has only the known
 * fields, non-empty bounded `bindingId`/`adapterId`/`connectionRef`, a boolean `enabled`, optional
 * `formIds` (at most {@link MAX_FORM_DELIVERY_FORM_IDS}; absent = every form, `[]` = none), an
 * object `config` with no secret-shaped key or value at any depth, and a `bindingId` no other
 * binding uses (the job index is unique per submission and binding, so a duplicate would abort
 * the whole delivery plan). Messages never repeat a config value.
 * @throws ValueValidationFailedError
 * @complexity O(bindings × (formIds + config size)).
 */
export function parseFormDeliveryBindings(required: { value: unknown }, _optional: Record<string, never> = {}): FormDeliveryBinding[] {
  const { value } = required;
  if (!Array.isArray(value)) throw invalid({ detail: "must be a JSON list of bindings." });
  if (value.length > MAX_FORM_DELIVERY_BINDINGS) throw invalid({ detail: `has ${value.length} bindings; at most ${MAX_FORM_DELIVERY_BINDINGS} are allowed. Remove some, then save again.` });
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const binding = parseBinding({ value: entry, where: `binding ${index + 1}` });
    if (seen.has(binding.bindingId)) throw invalid({ detail: `binding ${index + 1} repeats bindingId ${quote({ text: binding.bindingId })}; give every binding its own id.` });
    seen.add(binding.bindingId);
    return binding;
  });
}

function parseBinding(required: { value: unknown; where: string }): FormDeliveryBinding {
  const { value, where } = required;
  if (!isPlainObject(value)) throw invalid({ detail: `${where} must be an object.` });
  const unknown = Object.keys(value).find(key => !BINDING_FIELDS.has(key));
  if (unknown !== undefined) throw invalid({ detail: `${where} has unknown field ${quote({ text: unknown })}; allowed fields are ${[...BINDING_FIELDS].join(", ")}.` });
  if (typeof value.enabled !== "boolean") throw invalid({ detail: `${where}: enabled must be true or false.` });
  const formIds = parseFormIds({ value: value.formIds, where });
  return {
    bindingId: parseReference({ value: value.bindingId, where, field: "bindingId" }),
    adapterId: parseReference({ value: value.adapterId, where, field: "adapterId" }),
    connectionRef: parseReference({ value: value.connectionRef, where, field: "connectionRef" }),
    enabled: value.enabled,
    ...(formIds === undefined ? {} : { formIds }),
    config: parseConfig({ value: value.config, where }),
  };
}

/** Ids and references are checked like config values: a secret pasted into one would be stored
 *  and copied into every delivery job as plainly as one in `config`. */
function parseReference(required: { value: unknown; where: string; field: string }): string {
  const { value, where, field } = required;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REFERENCE_LENGTH) {
    throw invalid({ detail: `${where}: ${field} must be a non-empty string of at most ${MAX_REFERENCE_LENGTH} characters.` });
  }
  assertNotSecretValue({ path: field, value, where });
  return value;
}

function parseFormIds(required: { value: unknown; where: string }): string[] | undefined {
  const { value, where } = required;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid({ detail: `${where}: formIds must be a list of form ids (omit it for every form).` });
  if (value.length > MAX_FORM_DELIVERY_FORM_IDS) throw invalid({ detail: `${where}: formIds has ${value.length} entries; at most ${MAX_FORM_DELIVERY_FORM_IDS} are allowed (omit formIds to mean every form).` });
  return value.map((id: unknown) => parseReference({ value: id, where, field: "every formIds entry" }));
}

/** Walks the config iteratively (no recursion limit to hit) and returns a deep copy. */
function parseConfig(required: { value: unknown; where: string }): Record<string, unknown> {
  const { value, where } = required;
  if (!isPlainObject(value)) throw invalid({ detail: `${where}: config must be an object (use {} when the destination needs none).` });
  const pending: { path: string; value: unknown }[] = [{ path: "config", value }];
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (typeof next.value === "string") {
      assertNotSecretValue({ path: next.path, value: next.value, where });
    } else if (next.value !== null && typeof next.value === "object") {
      pending.push(...childrenOf({ path: next.path, value: next.value, where }));
    } else {
      // Nulls and scalar values contain no child fields to inspect.
    }
  }
  return structuredClone(value);
}

function childrenOf(required: { path: string; value: object; where: string }): { path: string; value: unknown }[] {
  return Object.entries(required.value).map(([key, child]) => {
    const path = `${required.path}.${key}`;
    if (SECRET_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) throw invalid({ detail: `${required.where}: ${quote({ text: path })} is named like a secret. ${FIX_HINT}` });
    return { path, value: child };
  });
}

function assertNotSecretValue(required: { path: string; value: string; where: string }): void {
  if (SECRET_VALUES.some(pattern => pattern.test(required.value)) || SECRET_SHAPE_PATTERNS.some(({ pattern }) => { pattern.lastIndex = 0; return pattern.test(required.value); }) || isBasicCredential({ value: required.value })) {
    throw invalid({ detail: `${required.where}: ${quote({ text: required.path })} holds a value that looks like a credential. ${FIX_HINT}` });
  }
}

/** An HTTP Basic Authorization value: base64 that decodes to `user:password`. Decoding keeps plain
 *  words after "Basic" (a "Basic tier" plan name) usable. */
function isBasicCredential({ value }: { value: string }, _optional = {}): boolean {
  const encoded = BASIC_VALUE.exec(value)?.[1];
  return encoded !== undefined && Buffer.from(encoded, "base64").toString("utf8").includes(":");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Names from the setting are echoed bounded and quoted, never config values. */
function quote({ text }: { text: string }, _optional = {}): string {
  return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}

function invalid({ detail }: { detail: string }, _optional = {}): ValueValidationFailedError {
  return new ValueValidationFailedError(`Form delivery bindings (${NAMESPACE}.${BINDINGS_KEY}) ${detail}`);
}
