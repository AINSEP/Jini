/**
 * @file The runtime half of `AdminEntityPort`: registration, descriptor validation, and the one
 * erasure a screen generic over all entities needs.
 *
 * `core/ports/entities.ts` is types only, like every other port. Everything here is the code those
 * types cannot be: checks that a descriptor is internally consistent, and the single cast that
 * turns a descriptor-generic port into the shape a screen can hold.
 *
 * ## Why any of this is runtime rather than type-level
 *
 * Two of the descriptor's own promises are not expressible in the type system:
 *
 * - `titleField` names a `text` field on this same descriptor. Encoding that needs a conditional
 *   type heavy enough to make every descriptor's error message unreadable — and a typo here is not
 *   cosmetic: it makes every relation picker pointing at this entity render `undefined` for every
 *   row, which looks like missing data rather than a typo.
 * - `relation.target` names another *registered* entity. A descriptor cannot know what it will be
 *   registered beside, so this can only be checked once the registry is assembled.
 *
 * Both are therefore checked at composition time, where they fail once, at startup, naming the
 * problem — rather than at render time, silently, as blank cells.
 */

import type {
  AdminEntityDescriptor,
  AdminEntityField,
  AdminEntityListQuery,
  AdminEntityPage,
  AdminEntityPort,
  AdminEntityRegistry,
  AdminEntityRowData,
  AdminErasedEntityPort,
} from '../ports/entities.js';

/** Row keys are never declared as fields — every row carries one implicitly. */
const IMPLICIT_ROW_KEY = 'id';

/** Bounds on the `json` conformance walk. Sized like `MAX_FIELD_DEFS` in `@jini-ai/cms`: large
 *  enough that no honest payload hits them, small enough that a cyclic or adversarial value fails
 *  fast instead of hanging a render. */
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;

/**
 * A row that does not match the descriptor its port advertises.
 *
 * This is the failure `eraseEntityPort`'s cast makes possible: the cast is sound in the direction
 * that matters (a typed row *is* a bag of unknowns), and unsound only if an adapter lies about its
 * own descriptor. Nothing in the type system catches that, so this is what does — as a report, not
 * an exception: a mistyped field is a fidelity problem, and throwing on a read would take a
 * mostly-working screen down over one bad cell.
 */
export interface AdminEntityRowViolation {
  /** `descriptor.name` of the port that produced the row. */
  readonly entity: string;
  readonly operation: 'list' | 'get' | 'create' | 'update';
  /** The offending row's `id`, or `'<no id>'` when that is itself what is wrong. */
  readonly rowId: string;
  /** Declared field name, `'id'`, or the undeclared key that appeared. */
  readonly field: string;
  readonly problem: 'missing-required' | 'wrong-type' | 'undeclared-field';
  /** One sentence naming what was expected and what arrived. Safe to log verbatim. */
  readonly detail: string;
}

export interface AdminEntityErasureOptions {
  /**
   * Where descriptor-conformance violations are reported.
   *
   * **Omit it and no row checking runs at all** — that is the zero-cost default, and it is why this
   * package emits no diagnostics of its own (nothing here writes to `console`; a host owns its
   * reporting the same way it owns its transport). A host wires this under its own development
   * flag and gets adapter drift surfaced the moment it happens; production pays nothing.
   */
  readonly onViolation?: (violation: AdminEntityRowViolation) => void;
}

/**
 * Whether `value` is a JSON value: `null`, a boolean, a *finite* number, a string, an array of
 * them, or a plain object of them.
 *
 * Bounded by {@link MAX_JSON_DEPTH}/{@link MAX_JSON_NODES}, which also makes it terminate on a
 * cyclic value rather than recursing forever. "Storage-only" means not indexed — it does not mean
 * not checked: a validator that returns true for everything is not a validator, and the values it
 * would wave through (functions, `BigInt`, `undefined`, `NaN`, cycles) are exactly the ones that
 * throw or silently vanish at the `JSON.stringify` boundary downstream of it.
 *
 * @returns `null` when the value conforms, otherwise a one-phrase reason.
 * @complexity Time O(nodes) bounded by {@link MAX_JSON_NODES}; space O(depth) bounded by
 *   {@link MAX_JSON_DEPTH}.
 * @overallScore 100
 */
function describeNonJsonValue(
  { value, depth, budget }: { value: unknown; depth: number; budget: { nodes: number } },
  _optional: Record<string, never> = {},
): string | null {
  if (depth > MAX_JSON_DEPTH) return `nests deeper than ${MAX_JSON_DEPTH} levels`;
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES) return `holds more than ${MAX_JSON_NODES} values`;
  if (value === null || typeof value !== 'object') return describeNonJsonScalar(value);
  // Rejects class instances, `Map`, `Date`, and anything else that survives `typeof === 'object'`
  // but does not round-trip through JSON as itself.
  if (!Array.isArray(value) && !isPlainObject(value)) return 'is a non-plain object';
  for (const item of Object.values(value)) {
    const reason = describeNonJsonValue({ value: item, depth: depth + 1, budget });
    if (reason !== null) return reason;
  }
  return null;
}

/** The leaf half of {@link describeNonJsonValue}: `null` or a non-object `value`. */
function describeNonJsonScalar(value: unknown): string | null {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return null;
  if (type === 'number') return Number.isFinite(value) ? null : 'is a non-finite number';
  return `is a ${type}`;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `null` when `typeof value` is `type`, otherwise "expected <label>, got <typeof value>". */
function describeWrongType(
  { value, type, label }: { value: unknown; type: 'string' | 'number' | 'boolean'; label: string },
  _optional: Record<string, never> = {},
): string | null {
  return typeof value === type ? null : `expected ${label}, got ${typeof value}`;
}

function describeNonDatetime(value: unknown): string | null {
  if (typeof value !== 'string') return `expected an ISO-8601 string, got ${typeof value}`;
  // A `datetime` that is not parseable renders fine and orders wrongly — the exact class of
  // fault this whole check exists for, so it is a mismatch rather than a pass.
  return Number.isNaN(Date.parse(value)) ? 'is not a parseable ISO-8601 timestamp' : null;
}

function describeNonNumber(
  { value, accepts, reason }: { value: unknown; accepts: (n: number) => boolean; reason: string },
  _optional: Record<string, never> = {},
): string | null {
  if (typeof value !== 'number') return `expected a number, got ${typeof value}`;
  return accepts(value) ? null : reason;
}

function describeNonJson(value: unknown): string | null {
  const reason = describeNonJsonValue({ value, depth: 0, budget: { nodes: 0 } });
  return reason === null ? null : `is not a JSON value: it ${reason}`;
}

/**
 * Whether `value` is a legal runtime value for `field`.
 *
 * Exported because an EDITOR needs exactly this judgement and must not re-derive it. A generic form
 * that decides for itself what an `integer` accepts will drift from what the conformance walk
 * below rejects, and the two disagreeing is worse than either being wrong alone: the form saves a
 * value the port then reports as a violation, so the write succeeds and the diagnostic blames the
 * adapter. `1.5` in an `integer` and `Infinity` in a `real` are both reachable from a plain
 * `<input type="number">` — `step` constrains the spinner, not the parsed value — so this is not a
 * theoretical seam. One function, both callers.
 *
 * @param field The declared field the value is destined for.
 * @param value The candidate value, typically a form draft entry or an adapter-returned cell.
 * @returns `null` when it conforms, otherwise a one-phrase reason naming what arrived instead.
 *   Phrased to complete the sentence "declared `<kind>`; ...".
 * @complexity Time O(1) for every kind but `json`; see {@link describeNonJsonValue} for that one.
 * @overallScore 100
 */
export function describeAdminEntityFieldMismatch(
  field: AdminEntityField,
  value: unknown,
): string | null {
  switch (field.kind) {
    case 'text':
    case 'relation':
      return describeWrongType({ value, type: 'string', label: 'a string' });
    case 'datetime':
      return describeNonDatetime(value);
    case 'integer':
      return describeNonNumber({ value, accepts: Number.isInteger, reason: 'is not an integer' });
    case 'real':
      return describeNonNumber({
        value,
        accepts: Number.isFinite,
        reason: 'is not a finite number',
      });
    case 'boolean':
      return describeWrongType({ value, type: 'boolean', label: 'a boolean' });
    case 'json':
      return describeNonJson(value);
  }
}

/**
 * Every way `row` fails to match `descriptor`.
 *
 * Reports undeclared keys as well as missing and mistyped ones: a key the descriptor does not
 * mention is invisible to a generic screen, so an adapter growing a field without declaring it
 * shows up as data that exists and never renders — which reads as a screen bug rather than a
 * descriptor gap.
 *
 * @complexity Time O(fields + row keys) plus the `json` walk; space O(violations).
 * @overallScore 100
 */
function findRowViolations(
  {
    descriptor,
    operation,
    row,
  }: {
    descriptor: AdminEntityDescriptor;
    operation: AdminEntityRowViolation['operation'];
    row: AdminEntityRowData;
  },
  _optional: Record<string, never> = {},
): readonly AdminEntityRowViolation[] {
  const hasId = typeof row.id === 'string' && row.id !== '';
  const rowId = hasId ? row.id : '<no id>';
  const at = { entity: descriptor.name, operation, rowId };
  const found: AdminEntityRowViolation[] = [];
  if (!hasId) {
    found.push({
      ...at,
      field: IMPLICIT_ROW_KEY,
      problem: 'wrong-type',
      detail: 'every row must carry a non-empty string `id`',
    });
  }
  for (const field of descriptor.fields) {
    const problem = describeFieldProblem({ field, value: row[field.name] });
    if (problem !== null) found.push({ ...at, field: field.name, ...problem });
  }
  const declared = new Set([IMPLICIT_ROW_KEY, ...descriptor.fields.map((field) => field.name)]);
  for (const key of Object.keys(row)) {
    if (declared.has(key)) continue;
    found.push({
      ...at,
      field: key,
      problem: 'undeclared-field',
      detail: 'present on the row but not declared on the descriptor',
    });
  }
  return found;
}

/** What is wrong with one declared field's cell, or `null` when it conforms or is legally absent. */
function describeFieldProblem(
  { field, value }: { field: AdminEntityField; value: unknown },
  _optional: Record<string, never> = {},
): Pick<AdminEntityRowViolation, 'problem' | 'detail'> | null {
  if (value === undefined) {
    return field.required === true
      ? { problem: 'missing-required', detail: 'declared `required: true` but absent from the row' }
      : null;
  }
  const mismatch = describeAdminEntityFieldMismatch(field, value);
  return mismatch === null
    ? null
    : { problem: 'wrong-type', detail: `declared \`${field.kind}\`; ${mismatch}` };
}

/**
 * Runs `row` past its descriptor and reports anything wrong, then returns it unchanged.
 *
 * Deliberately identity-returning: this is an observation point, never a repair point. Coercing a
 * bad value here would hide the adapter bug it exists to expose.
 *
 * Only {@link eraseEntityPort}'s checking wrapper calls this, and that wrapper exists only when
 * `onViolation` is set — so the sink is required here rather than re-checked.
 *
 * @complexity Time O(rows × fields).
 * @overallScore 100
 */
function checkRow<TRow extends AdminEntityRowData>(
  {
    descriptor,
    operation,
    row,
    onViolation,
  }: {
    descriptor: AdminEntityDescriptor;
    operation: AdminEntityRowViolation['operation'];
    row: TRow;
    onViolation: (violation: AdminEntityRowViolation) => void;
  },
  _optional: Record<string, never> = {},
): TRow {
  for (const violation of findRowViolations({ descriptor, operation, row })) onViolation(violation);
  return row;
}

/**
 * Erases a port's descriptor generic so a screen can hold ports for different entities in one
 * collection.
 *
 * The `as unknown as` below is unavoidable and is the only one in this port. `create` and `update`
 * take the row type as a *parameter*, so `AdminEntityPort<SpecificDescriptor>` is contravariant in
 * it and is genuinely not assignable to any common supertype. The cast is sound in the direction
 * that gets exercised — a typed row is a bag of unknowns — and unsound only if the adapter's rows
 * do not match the descriptor it advertises, which is precisely what `options.onViolation` is here
 * to surface.
 *
 * @param port A port whose rows are typed by its own descriptor.
 * @param options Wire `onViolation` to have every row checked against the descriptor on the way
 *   out; omit it for zero added cost.
 * @returns The same port, typed as {@link AdminErasedEntityPort}; a fresh wrapper object when
 *   `onViolation` is set, and the original object when it is not.
 * @complexity Time O(1) to erase; O(rows × fields) per call when checking is on.
 * @overallScore 100
 */
export function eraseEntityPort<D extends AdminEntityDescriptor>(
  port: AdminEntityPort<D>,
  options: AdminEntityErasureOptions = {},
): AdminErasedEntityPort {
  const erased = port as unknown as AdminErasedEntityPort;
  const { onViolation } = options;
  if (onViolation === undefined) return erased;

  const { descriptor } = port;
  const checked: AdminErasedEntityPort = {
    descriptor,
    async list(query?: AdminEntityListQuery): Promise<AdminEntityPage<AdminEntityRowData>> {
      const page = await erased.list(query);
      for (const row of page.items) checkRow({ descriptor, operation: 'list', row, onViolation });
      return page;
    },
    async get(id: string): Promise<AdminEntityRowData | null> {
      const row = await erased.get(id);
      return row === null ? null : checkRow({ descriptor, operation: 'get', row, onViolation });
    },
    async create(input: Record<string, unknown>): Promise<AdminEntityRowData> {
      const row = await erased.create(input);
      return checkRow({ descriptor, operation: 'create', row, onViolation });
    },
    async update(id: string, patch: Record<string, unknown>): Promise<AdminEntityRowData> {
      const row = await erased.update(id, patch);
      return checkRow({ descriptor, operation: 'update', row, onViolation });
    },
  };
  // Preserved by presence, not by a forwarding stub: a screen decides whether to render a delete
  // affordance by testing `remove !== undefined`, so wrapping an absent one into an always-present
  // function would give every entity a delete button that throws.
  const { remove } = erased;
  if (remove === undefined) return checked;
  // `.call(erased, ...)` rather than a bare reference: an adapter written as an object literal with
  // shorthand methods may legitimately use `this` to reach its own store.
  return { ...checked, remove: (id: string) => remove.call(erased, id) };
}

/**
 * Every internal inconsistency in one descriptor, as human-readable sentences.
 *
 * @param descriptor The descriptor to check.
 * @param registryKey The key it is being registered under.
 * @param registeredNames Every name in the registry, for resolving `relation` targets.
 * @complexity Time O(fields); space O(problems).
 * @overallScore 100
 */
function findDescriptorProblems(
  {
    descriptor,
    registryKey,
    registeredNames,
  }: {
    descriptor: AdminEntityDescriptor;
    registryKey: string;
    registeredNames: ReadonlySet<string>;
  },
  _optional: Record<string, never> = {},
): readonly string[] {
  const at = `'${registryKey}'`;
  return [
    ...findHeaderProblems({ descriptor, registryKey }),
    ...findFieldProblems({ descriptor, registeredNames }),
    ...findTitleFieldProblems({ descriptor }),
  ].map((problem) => `${at}: ${problem}`);
}

function findHeaderProblems(
  { descriptor, registryKey }: { descriptor: AdminEntityDescriptor; registryKey: string },
  _optional: Record<string, never> = {},
): string[] {
  const problems: string[] = [];
  if (descriptor.name !== registryKey) {
    // One entity, one name. Allowing these to differ would leave the URL segment, the relation
    // target, and the registry key as three identifiers with no stated relationship between them.
    problems.push(
      `registered under '${registryKey}' but its descriptor is named '${descriptor.name}'`,
    );
  }
  if (descriptor.labelSingular === '' || descriptor.labelPlural === '') {
    problems.push('labelSingular and labelPlural must both be non-empty');
  }
  if (descriptor.fields.length === 0) {
    problems.push('declares no fields, so nothing but its id could ever be shown or edited');
  }
  return problems;
}

function findFieldProblems(
  {
    descriptor,
    registeredNames,
  }: { descriptor: AdminEntityDescriptor; registeredNames: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const field of descriptor.fields) {
    if (field.name === '') {
      problems.push('a field has an empty name');
      continue;
    }
    if (field.name === IMPLICIT_ROW_KEY) {
      problems.push(
        `'${IMPLICIT_ROW_KEY}' is implicit on every row and must not be declared as a field`,
      );
    }
    if (seen.has(field.name)) problems.push(`field '${field.name}' is declared more than once`);
    seen.add(field.name);
    if (field.kind === 'relation' && !registeredNames.has(field.target)) {
      problems.push(
        `field '${field.name}' targets '${field.target}', which is not a registered entity`,
      );
    }
  }
  return problems;
}

function findTitleFieldProblems(
  { descriptor }: { descriptor: AdminEntityDescriptor },
  _optional: Record<string, never> = {},
): string[] {
  const titleField = descriptor.fields.find((field) => field.name === descriptor.titleField);
  if (titleField === undefined) {
    return [`titleField '${descriptor.titleField}' does not name a declared field`];
  }
  if (titleField.kind !== 'text') {
    return [
      `titleField '${descriptor.titleField}' is kind '${titleField.kind}'; a title must be 'text'`,
    ];
  }
  return [];
}

/**
 * Assembles entity ports into a registry, validating every descriptor first.
 *
 * Same ergonomics as `createAdminClient`: one object literal, `TPorts` inferred, host-owned and
 * Jini-shipped entries indistinguishable. Registering an entity is one line.
 *
 * **No key is reserved.** `createAdminClient` reserves `'transport'` because it merges the
 * transport into the same object it returns; this returns nothing but the ports, so there is
 * nothing an entity named `transport` could shadow. The returned object has a `null` prototype, so
 * a lookup by an attacker- or URL-supplied name (`'constructor'`, `'__proto__'`) resolves to
 * `undefined` rather than walking to `Object.prototype` and yielding a truthy non-port.
 *
 * Deliberately takes no erasure options: a registry holds ports with their row types intact, and
 * checking only becomes possible once those types are erased. `onViolation` therefore belongs to
 * {@link getErasedEntityPort}/{@link listErasedEntityPorts}, at the point the guarantee is dropped.
 *
 * @param ports Entity name -> port. Each key must equal that port's `descriptor.name`.
 * @returns A frozen, null-prototype registry preserving each port's own type.
 * @throws {Error} listing *every* problem found, not just the first — a descriptor with three
 *   typos should take one round trip to fix, not three.
 * @complexity Time O(entities × fields); space O(entities).
 * @overallScore 100
 */
export function createAdminEntityRegistry<
  TPorts extends Record<string, AdminEntityPort<AdminEntityDescriptor>>,
>(ports: TPorts): AdminEntityRegistry<TPorts> {
  const entries = Object.entries(ports);
  const registeredNames = new Set(entries.map(([, port]) => port.descriptor.name));

  const problems = entries.flatMap(([key, port]) =>
    findDescriptorProblems({ descriptor: port.descriptor, registryKey: key, registeredNames }),
  );
  if (problems.length > 0) {
    throw new Error(`createAdminEntityRegistry: invalid descriptors\n- ${problems.join('\n- ')}`);
  }

  const registry = Object.create(null) as Record<string, AdminEntityPort<AdminEntityDescriptor>>;
  for (const [key, port] of entries) registry[key] = port;
  return Object.freeze(registry) as AdminEntityRegistry<TPorts>;
}

/**
 * Every registered port, erased, in registration order — what a screen that renders any entity
 * iterates.
 *
 * @complexity Time O(entities); space O(entities).
 * @overallScore 100
 */
export function listErasedEntityPorts(
  registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>,
  options: AdminEntityErasureOptions = {},
): readonly AdminErasedEntityPort[] {
  return Object.values(registry).map((port) => eraseEntityPort(port, options));
}

/**
 * The erased port registered under `name`, or `null`.
 *
 * `name` is routinely a URL segment, so this never trusts a bare property read: the registry's null
 * prototype already stops `'constructor'` resolving to something truthy, and `Object.hasOwn` holds
 * that guarantee even for a caller that hands in a plain object literal instead.
 *
 * @complexity Time O(1) for the lookup, O(1) for the erasure.
 * @overallScore 100
 */
export function getErasedEntityPort(
  registry: Readonly<Record<string, AdminEntityPort<AdminEntityDescriptor>>>,
  name: string,
  options: AdminEntityErasureOptions = {},
): AdminErasedEntityPort | null {
  if (!Object.hasOwn(registry, name)) return null;
  const port = registry[name];
  return port === undefined ? null : eraseEntityPort(port, options);
}
