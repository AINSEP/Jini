/**
 * @file A plugin's manifest-declared content types (the plugin manifest → `contentTypes`) — parse,
 * plan against what the site already has, and apply through the host's ONE content-type write path
 * (behind {@link DeclaredContentTypeWritePorts}). AW-7 Tier 1, 2026-10-04.
 *
 * Why this exists: ADR-024 §1 defines Tier-1 as a manifest-only plugin whose first contribution is
 * "content types & fields", but `manifest.ts` only ever parsed-and-stored `contentTypes` (state.spec
 * §2: "UNUSED in v1"). This module is the missing half: a bounded, closed declaration grammar
 * (ADR-024 §5 — Tier-1 is only safe while its surface is non-Turing-complete and bounded) and an
 * idempotent provisioner that runs at enable time.
 *
 * Rules the provisioner keeps (and why):
 * - **Create if missing, never overwrite.** An existing type that already holds every declared field
 *   with the same kind is KEPT (the owner may have added fields of their own through Collections —
 *   that is their data model now). An existing type that disagrees is a CONFLICT and the enable is
 *   refused before anything is written, rather than silently reshaping someone's content.
 * - **A tombstoned type is skipped.** The owner deleted it on purpose; tombstone is terminal and the
 *   key can never be reused (content-types INV-06), so re-enabling the plugin does not resurrect it.
 * - **Retain on disable/uninstall** (ADR-023/ADR-024 retain-by-default): nothing here ever removes a
 *   type. The entries are the owner's content, not the plugin's.
 *
 * Pure parsing; the plan/apply halves do I/O only through the injected ports.
 *
 * Ownership split (EXTRACT-S6 L1a): the bounds, grammar, tier rule, plan and apply are plugin-domain
 * and live here. The content-type vocabulary (field kinds, both kind checks, identifier grammar and
 * the already-exists classifier) comes from the host through {@link DeclaredContentTypeCms}, and the
 * reserved keys are a required host input — see {@link createDeclarativeContentTypes}. Where a type
 * is stored (its entry envelope) is the host's `register` decision; nothing here names one.
 */
import type { ContentTypeFieldDef, ContentTypeFieldKind, ContentTypeRecord } from "@jini-ai/core/contracts/content-types";

import { PluginInvalidError } from "./activation.js";
import type { PluginValidationError } from "./manifest-types.js";
import type { DeclaredContentType, DeclaredContentTypePlan } from "./ports.js";

/** ADR-024 §5 bound: how many content types one plugin may declare. */
export const MAX_DECLARED_CONTENT_TYPES = 20;
/** ADR-024 §5 bound: how many fields one declared content type may carry. */
export const MAX_DECLARED_FIELDS = 50;
/** Core's own per-type queryable-field cap (`QUERYABLE_FIELD_CAP` in `@jini-ai/cms`'s
 *  `registerContentType`, not exported). Checked here so a declaration core would refuse is
 *  `invalid` at discovery, instead of failing at enable after the plugin's code attached.
 *  @agent-note A host whose own write path allows fewer queryable fields still refuses at
 *  `register`; that refusal surfaces as an enable failure, never as a lost race. */
export const MAX_DECLARED_QUERYABLE_FIELDS = 20;
const MAX_LABEL_LENGTH = 100;

const DECL_KEYS: ReadonlySet<string> = new Set(["key", "label", "fields"]);
const FIELD_KEYS: ReadonlySet<string> = new Set(["name", "kind", "required", "queryable"]);

/**
 * The content-type vocabulary the declaration grammar is checked against. Supplied by the host from
 * its own content-type implementation; this package never imports one.
 *
 * @agent-note Second-host rules: every member is called detached (no `this`), synchronously and
 * without side effects, during `parse`/`validateManifest` (discovery) and `apply` (enable). One
 * object is captured per {@link createDeclarativeContentTypes} call and reused for every plugin and
 * call; it must describe the SAME rules the host's `register` enforces, or a declaration valid here
 * fails later at enable.
 */
export interface DeclaredContentTypeCms {
  /** @agent-note The host's closed field-kind list. Printed verbatim, in this order, in the
   *  unknown-kind diagnostic. Every listed kind must pass `isFieldKind`. */
  readonly fieldKinds: readonly ContentTypeFieldKind[];
  /** @agent-note True exactly for the kinds in `fieldKinds`. Pure; receives any manifest value. */
  readonly isFieldKind: (required: { value: unknown }) => boolean;
  /** @agent-note True for kinds the host can index; a `queryable` field of any other kind is
   *  refused at parse. Pure; called only with a value that already passed `isFieldKind`. */
  readonly isIndexable: (required: { value: unknown }) => boolean;
  /** @agent-note The host's identifier grammar, used for type keys and field names. Pure. */
  readonly validateIdentifier: (required: { value: string }) => boolean;
  /** @agent-note Human-readable form of `validateIdentifier` (e.g. a regex source). Printed verbatim
   *  in diagnostics, so a host that must keep saved/compared diagnostic text supplies its exact
   *  bytes. */
  readonly identifierGrammar: string;
  /**
   * Classifies the error `register` returned: `true` ONLY for the host's own "this key already
   * exists" rejection (a lost concurrent create). The winner is then re-read and judged.
   * @agent-note Must not throw. Any error it does not recognize is rethrown unchanged by `apply`
   * with its identity intact, so return `false` for infrastructure failures, validation refusals
   * and unknown values. Matching by message text is not identity; prefer the host's error class.
   */
  readonly isAlreadyExists: (required: { error: Error }) => boolean;
}

/** One validated content-type declaration, already in core's `ContentTypeFieldDef` shape.
 *  @agent-note Concrete form of the opaque {@link DeclaredContentType} that `ports.ts` carries;
 *  produced only by `parse`, never constructed by a host. */
export interface DeclaredContentTypeDefinition extends DeclaredContentType {
  readonly key: string;
  readonly label: string;
  readonly fields: readonly ContentTypeFieldDef[];
}

export interface ParseDeclaredContentTypesResult {
  readonly decls: readonly DeclaredContentTypeDefinition[];
  readonly errors: readonly PluginValidationError[];
}

function declError(message: string): PluginValidationError {
  return { code: "CONTENT_TYPE_DECL_INVALID", file: null, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeyErrors(raw: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): PluginValidationError[] {
  return Object.keys(raw)
    .filter((key) => !allowed.has(key))
    .map((key) => declError(`${where} has an unknown key '${key}'`));
}

function optionalFlag(raw: Record<string, unknown>, flag: "required" | "queryable", where: string, errors: PluginValidationError[]): boolean {
  const value = raw[flag];
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  errors.push(declError(`${where} '${flag}' must be a boolean`));
  return false;
}

function duplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return [...duplicates];
}

function labelValid(label: unknown): label is string {
  return typeof label === "string" && label.trim().length > 0 && label.length <= MAX_LABEL_LENGTH;
}

/** The manifest arrays only executable code can use — a Tier-1 plugin has none to use them with. */
const CODE_SURFACES = ["capabilities", "hooks", "fields"] as const;

/** The manifest keys the declarative rules read. Values are `unknown` so `validateManifest` can pass
 *  its raw, not-yet-validated object, and a parsed `PluginManifest` fits too. */
export interface DeclarativeManifestView {
  readonly tier?: unknown;
  readonly contentTypes?: unknown;
  readonly capabilities?: unknown;
  readonly hooks?: unknown;
  readonly fields?: unknown;
}

/**
 * The two content-type operations the provisioner needs. `register` is the host's content-type
 * write path bound by the composition root; it returns a `Result` rather than throwing for an
 * expected rejection.
 *
 * @agent-note Second-host rules: `findByKey` reads the type stored under `key` in `workspaceId`
 * (the enabling workspace) and resolves `null` when there is none; a tombstoned type is returned
 * with `status: "tombstone"`, never hidden. `register` performs ONE host write per call, in plan
 * order, and resolves `{ ok: false, error }` for an expected rejection (including a lost create
 * race) instead of throwing. `actorId` arrives as `plugin:<id>`; the host records it as the
 * revision author. The host owns authorization (enable already required the plugin-manage
 * permission and consent), the storage envelope/owner the type is registered under (nothing here
 * passes one — register where the host's readers look), revisions and outbox. Both members must hit
 * the same store so the post-race re-read sees the winner. No cleanup is ever requested: types are
 * retained on disable/uninstall.
 */
export interface DeclaredContentTypeWritePorts {
  findByKey(params: { workspaceId: string; key: string }): Promise<ContentTypeRecord | null>;
  register(input: {
    workspaceId: string;
    key: string;
    label: string;
    fields: ContentTypeFieldDef[];
    actorId: string;
  }): Promise<{ ok: true } | { ok: false; error: Error }>;
}

export type DeclaredContentTypeOutcome = "create" | "keep" | "skip-tombstoned";

/** @agent-note Concrete form of the opaque {@link DeclaredContentTypePlan}; produced only by `plan`
 *  and passed unchanged to `apply` of the SAME instance. */
export interface DeclaredContentTypeDefinitionPlan extends DeclaredContentTypePlan {
  readonly items: ReadonlyArray<{ readonly decl: DeclaredContentTypeDefinition; readonly outcome: DeclaredContentTypeOutcome }>;
  /** Human-readable reasons the plugin cannot be turned on. Non-empty ⇒ `items` is empty. */
  readonly conflicts: readonly string[];
}

/** Why `existing` cannot serve as `decl`'s type, one reason per disagreeing field. */
function incompatibilities(decl: DeclaredContentTypeDefinition, existing: ContentTypeRecord): string[] {
  const reasons: string[] = [];
  for (const field of decl.fields) {
    const held = existing.fields.find((candidate) => candidate.name === field.name);
    if (!held) {
      reasons.push(`content type '${decl.key}' already exists without field '${field.name}'`);
      continue;
    }
    if (held.kind !== field.kind) reasons.push(`content type '${decl.key}' already exists with field '${field.name}' as '${held.kind}', not '${field.kind}'`);
  }
  return reasons;
}

/**
 * Decides, without writing anything, what enabling would do to each declared type. A conflict on
 * ANY type refuses the whole plan, so an enable never leaves half a plugin's types behind.
 *
 * @complexity O(t) port reads plus O(t · f²) field comparison, all manifest-bounded.
 */
async function planDeclaredContentTypes(
  required: { ports: Pick<DeclaredContentTypeWritePorts, "findByKey">; workspaceId: string; decls: readonly DeclaredContentTypeDefinition[] },
  _optional: Record<string, never> = {}
): Promise<DeclaredContentTypeDefinitionPlan> {
  const { ports, workspaceId, decls } = required;
  const items: Array<{ decl: DeclaredContentTypeDefinition; outcome: DeclaredContentTypeOutcome }> = [];
  const conflicts: string[] = [];
  for (const decl of decls) {
    const existing = await ports.findByKey({ workspaceId, key: decl.key });
    if (!existing) items.push({ decl, outcome: "create" });
    else if (existing.status === "tombstone") items.push({ decl, outcome: "skip-tombstoned" });
    else {
      const reasons = incompatibilities(decl, existing);
      if (reasons.length === 0) items.push({ decl, outcome: "keep" });
      conflicts.push(...reasons);
    }
  }
  return conflicts.length > 0 ? { items: [], conflicts } : { items, conflicts };
}

export interface ApplyDeclaredContentTypesResult {
  readonly created: readonly string[];
  readonly kept: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * What losing a concurrent create race means: the planning-time compatibility check never saw the
 * winning type, so it is re-read and judged the same way `planDeclaredContentTypes` would have —
 * compatible ⇒ kept, tombstoned ⇒ skipped, anything else refuses the enable.
 *
 * @throws {PluginInvalidError} the winner disagrees with the declaration.
 * @throws the original `lost` error when the winner cannot be read back.
 * @complexity One port read plus O(f²) field comparison.
 */
async function judgeLostRace(
  required: { ports: DeclaredContentTypeWritePorts; workspaceId: string; pluginId: string; decl: DeclaredContentTypeDefinition; lost: Error }
): Promise<"keep" | "skip-tombstoned"> {
  const { ports, workspaceId, pluginId, decl, lost } = required;
  const winner = await ports.findByKey({ workspaceId, key: decl.key });
  if (!winner) throw lost;
  if (winner.status === "tombstone") return "skip-tombstoned";
  const reasons = incompatibilities(decl, winner);
  if (reasons.length > 0) throw new PluginInvalidError(`plugin '${pluginId}' cannot be turned on: ${reasons.join("; ")}`);
  return "keep";
}

/**
 * One host's bound declaration rules. Its members have the shapes of
 * `DeclarativeContentTypesPort` (`ports.ts`), so the object can be passed as that port directly.
 *
 * @agent-note Second-host rules: use ONE instance for discovery (`validateManifest`), install and
 * enable (`parse`/`plan`/`apply`) so all three judge declarations with the same reserved keys and
 * vocabulary. `plan` and `apply` must receive the same `DeclaredContentTypeWritePorts` (same store)
 * within one enable, and `apply` only a plan `plan` produced with no conflicts. Nothing is cached
 * between calls; instances are safe to share across workspaces and concurrent enables.
 */
export interface DeclarativeContentTypes {
  /**
   * The declarative half of a manifest's validation: its `contentTypes`, plus — for a `tier-1`
   * plugin — the rule that it declares no code surface. Hooks, capability grants and `ext` fields
   * all exist to be used by plugin code, and a Tier-1 plugin is never imported (ADR-024 §1: "zero
   * executable code"), so declaring one is either a mistake or an attempt to look like something it
   * is not. `validateManifest()` calls this, so discovery lists a bad declaration as `invalid`
   * instead of it failing only at enable. A surface that is not an array is left to
   * `validateManifest`'s own malformed check (reported once, not twice).
   * @agent-note Collect-all, never throws; code-surface errors come before declaration errors.
   */
  validateManifest(required: { manifest: DeclarativeManifestView }, optional?: Record<string, never>): ParseDeclaredContentTypesResult;
  /**
   * Parses a manifest's raw `contentTypes` value. Collect-all, never throws (same contract as
   * `validateManifest`). `undefined`/`null` declare nothing.
   * @agent-note Errors keep declaration order, field errors inside their type, duplicates last.
   */
  parse(required: { value: unknown }, optional?: Record<string, never>): ParseDeclaredContentTypesResult;
  /** @agent-note Read-only: one `findByKey` per declaration, in order; writes nothing, even when
   *  every type is new. A conflict on any type empties `items`. */
  plan(
    required: { ports: Pick<DeclaredContentTypeWritePorts, "findByKey">; workspaceId: string; decls: readonly DeclaredContentTypeDefinition[] },
    optional?: Record<string, never>
  ): Promise<DeclaredContentTypeDefinitionPlan>;
  /**
   * Carries out a conflict-free plan. Each create is recorded as `plugin:<id>` so the content-type
   * revision log says which plugin made the type; losing a concurrent create race is judged against
   * the winning type — kept only when it matches the declaration. Any other failure is rethrown
   * as-is.
   * @agent-note Sequential, in plan order; never removes or overwrites a type. A lost race is
   * recognized ONLY through `DeclaredContentTypeCms.isAlreadyExists`; an incompatible winner throws
   * this package's canonical `PluginInvalidError`; an unrecognized error is rethrown with its
   * identity. Types created before a failure stay (retain-by-default).
   */
  apply(
    required: { ports: DeclaredContentTypeWritePorts; workspaceId: string; pluginId: string; plan: DeclaredContentTypeDefinitionPlan },
    optional?: Record<string, never>
  ): Promise<ApplyDeclaredContentTypesResult>;
}

export interface CreateDeclarativeContentTypesRequired {
  /** @agent-note The host's content-type vocabulary; see {@link DeclaredContentTypeCms}. */
  readonly cms: DeclaredContentTypeCms;
  /**
   * Keys no plugin may declare: the host's own permanently reserved and system content types.
   * @agent-note Required, no default. Copied into a new `Set` once, when the instance is created:
   * later changes to the passed collection have no effect, and separate instances keep separate
   * sets. A declared key in the set is refused at parse as "reserved by core".
   */
  readonly reservedKeys: Iterable<string>;
}

/**
 * Binds the declaration grammar, tier rule, planner and provisioner to one host's content-type
 * vocabulary and reserved keys.
 *
 * @agent-note Second-host rules: call once at composition and share the result (see
 * {@link DeclarativeContentTypes}). Creation does no I/O and calls none of the `cms` members.
 * The host keeps the manifest file name, the write path, authorization, storage envelope and
 * reserved keys; this factory keeps only plugin-domain bounds, grammar and outcomes.
 *
 * @example createDeclarativeContentTypes({ cms: hostContentTypeVocabulary, reservedKeys: ["page"] }, {})
 */
export function createDeclarativeContentTypes(
  requiredArgs: CreateDeclarativeContentTypesRequired,
  _optionalArgs: Record<string, never> = {}
): DeclarativeContentTypes {
  // The local names keep the transported bodies below byte-identical to their origin.
  const {
    fieldKinds: CONTENT_TYPE_FIELD_KINDS,
    isFieldKind: isContentTypeFieldKind,
    isIndexable: isIndexableFieldKind,
    validateIdentifier: validateIdentifierGrammar,
    identifierGrammar: IDENTIFIER_GRAMMAR_TEXT,
    isAlreadyExists,
  } = requiredArgs.cms;
  const RESERVED_KEYS: ReadonlySet<string> = new Set(requiredArgs.reservedKeys);

  /** The name/kind half of one field — returns the validated pair, or `undefined` after recording why. */
  function fieldIdentity(raw: Record<string, unknown>, typeKey: string, errors: PluginValidationError[]): { name: string; kind: ContentTypeFieldKind } | undefined {
    const name = raw.name;
    if (typeof name !== "string" || !validateIdentifierGrammar({ value: name })) {
      errors.push(declError(`content type '${typeKey}' field name '${String(name)}' must match ${IDENTIFIER_GRAMMAR_TEXT}`));
      return undefined;
    }
    const kind = raw.kind;
    if (!isContentTypeFieldKind({ value: kind })) {
      errors.push(declError(`content type '${typeKey}' field '${name}' has kind '${String(kind)}'; allowed: ${CONTENT_TYPE_FIELD_KINDS.join("|")}`));
      return undefined;
    }
    return { name, kind: kind as ContentTypeFieldKind };
  }

  /** One `fields[]` entry. Collects every problem it finds; returns the field only when it has none. */
  function parseField(raw: unknown, index: number, typeKey: string): { field?: ContentTypeFieldDef; errors: PluginValidationError[] } {
    if (!isRecord(raw)) return { errors: [declError(`content type '${typeKey}' field ${index} must be an object`)] };
    const where = `content type '${typeKey}' field '${String(raw.name)}'`;
    const errors = unknownKeyErrors(raw, FIELD_KEYS, where);
    const identity = fieldIdentity(raw, typeKey, errors);
    const required = optionalFlag(raw, "required", where, errors);
    const queryable = optionalFlag(raw, "queryable", where, errors);
    if (identity && queryable && !isIndexableFieldKind({ value: identity.kind })) {
      errors.push(declError(`${where} has storage-only kind '${identity.kind}' and cannot be queryable`));
    }
    if (!identity || errors.length > 0) return { errors };
    return { field: { name: identity.name, kind: identity.kind, required, queryable }, errors };
  }

  function parseFields(raw: unknown, typeKey: string): { fields: ContentTypeFieldDef[]; errors: PluginValidationError[] } {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DECLARED_FIELDS) {
      return { fields: [], errors: [declError(`content type '${typeKey}' must declare 1-${MAX_DECLARED_FIELDS} fields`)] };
    }
    const parsed = raw.map((field, index) => parseField(field, index, typeKey));
    const fields = parsed.flatMap((result) => (result.field ? [result.field] : []));
    const errors = parsed.flatMap((result) => result.errors);
    for (const name of duplicateNames(fields.map((field) => field.name))) {
      errors.push(declError(`content type '${typeKey}' declares field '${name}' more than once`));
    }
    const queryableCount = fields.filter((field) => field.queryable).length;
    if (queryableCount > MAX_DECLARED_QUERYABLE_FIELDS) {
      errors.push(declError(`content type '${typeKey}' declares ${queryableCount} queryable fields; at most ${MAX_DECLARED_QUERYABLE_FIELDS} are allowed`));
    }
    return { fields, errors };
  }

  function keyErrors(key: unknown, index: number): PluginValidationError[] {
    if (typeof key !== "string") return [declError(`contentTypes[${index}].key must be a string`)];
    if (!validateIdentifierGrammar({ value: key })) return [declError(`content type key '${key}' must match ${IDENTIFIER_GRAMMAR_TEXT}`)];
    if (RESERVED_KEYS.has(key)) return [declError(`content type key '${key}' is reserved by core`)];
    return [];
  }

  /** One `contentTypes[]` entry. */
  function parseDecl(raw: unknown, index: number): { decl?: DeclaredContentTypeDefinition; errors: PluginValidationError[] } {
    if (!isRecord(raw)) return { errors: [declError(`contentTypes[${index}] must be an object`)] };
    const errors = [...unknownKeyErrors(raw, DECL_KEYS, `contentTypes[${index}]`), ...keyErrors(raw.key, index)];
    const key = String(raw.key);
    if (!labelValid(raw.label)) errors.push(declError(`content type '${key}' needs a label of 1-${MAX_LABEL_LENGTH} characters`));
    const fields = parseFields(raw.fields, key);
    errors.push(...fields.errors);
    if (errors.length > 0) return { errors };
    return { decl: { key, label: raw.label as string, fields: fields.fields }, errors };
  }

  /**
   * Parses a manifest's raw `contentTypes` value. Collect-all, never throws (same contract as
   * `validateManifest`). `undefined`/`null` declare nothing.
   *
   * @complexity O(t · f) over declared types and their fields — both bounded by the MAX_* constants.
   */
  function parseDeclaredContentTypes(required: { value: unknown }, _optional: Record<string, never> = {}): ParseDeclaredContentTypesResult {
    const { value } = required;
    if (value === undefined || value === null) return { decls: [], errors: [] };
    if (!Array.isArray(value)) return { decls: [], errors: [declError("'contentTypes' must be an array")] };
    if (value.length > MAX_DECLARED_CONTENT_TYPES) {
      return { decls: [], errors: [declError(`'contentTypes' declares more than ${MAX_DECLARED_CONTENT_TYPES} content types`)] };
    }
    const parsed = value.map((entry, index) => parseDecl(entry, index));
    const decls = parsed.flatMap((result) => (result.decl ? [result.decl] : []));
    const errors = parsed.flatMap((result) => result.errors);
    for (const key of duplicateNames(decls.map((decl) => decl.key))) {
      errors.push(declError(`content type key '${key}' is declared more than once`));
    }
    return { decls, errors };
  }

  /** See {@link DeclarativeContentTypes.validateManifest}. */
  function validateDeclarativeManifest(required: { manifest: DeclarativeManifestView }, _optional: Record<string, never> = {}): ParseDeclaredContentTypesResult {
    const { manifest } = required;
    const parsed = parseDeclaredContentTypes({ value: manifest.contentTypes });
    if (manifest.tier !== "tier-1") return parsed;
    const surfaceErrors = CODE_SURFACES.filter((surface) => {
      const declared = manifest[surface];
      return Array.isArray(declared) && declared.length > 0;
    }).map((surface) => ({
      code: "TIER1_DECLARES_CODE_SURFACE",
      file: null,
      message: `a declarative (tier-1) plugin cannot declare '${surface}' — only code can use them`,
    }));
    return { decls: parsed.decls, errors: [...surfaceErrors, ...parsed.errors] };
  }

  /**
   * Carries out a conflict-free plan. Each create is recorded as `plugin:<id>` so the content-type
   * revision log says which plugin made the type; losing a concurrent create race is judged against
   * the winning type ({@link judgeLostRace}) — kept only when it matches the declaration. Any other
   * failure is rethrown as-is.
   */
  async function applyDeclaredContentTypes(
    required: { ports: DeclaredContentTypeWritePorts; workspaceId: string; pluginId: string; plan: DeclaredContentTypeDefinitionPlan },
    _optional: Record<string, never> = {}
  ): Promise<ApplyDeclaredContentTypesResult> {
    const { ports, workspaceId, pluginId, plan } = required;
    const created: string[] = [];
    const kept: string[] = [];
    const skipped: string[] = [];
    const bucket = { created, keep: kept, "skip-tombstoned": skipped };
    for (const { decl, outcome } of plan.items) {
      const applied = outcome === "keep" || outcome === "skip-tombstoned" ? outcome : await createDeclared({ ports, workspaceId, pluginId, decl });
      bucket[applied].push(decl.key);
    }
    return { created, kept, skipped };
  }

  /** Registers one planned type as `plugin:<id>`; a lost create race takes the judged winner's outcome. */
  async function createDeclared(
    required: { ports: DeclaredContentTypeWritePorts; workspaceId: string; pluginId: string; decl: DeclaredContentTypeDefinition }
  ): Promise<"created" | "keep" | "skip-tombstoned"> {
    const { ports, workspaceId, pluginId, decl } = required;
    const result = await ports.register({ workspaceId, key: decl.key, label: decl.label, fields: [...decl.fields], actorId: `plugin:${pluginId}` });
    if (result.ok) return "created";
    if (!isAlreadyExists({ error: result.error })) throw result.error;
    return judgeLostRace({ ports, workspaceId, pluginId, decl, lost: result.error });
  }

  return {
    validateManifest: validateDeclarativeManifest,
    parse: parseDeclaredContentTypes,
    plan: planDeclaredContentTypes,
    apply: applyDeclaredContentTypes,
  };
}
