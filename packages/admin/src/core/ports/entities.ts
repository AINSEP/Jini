/**
 * @file `AdminEntityPort` — the one port that is generic over the entity it fronts.
 *
 * ## Why this port is shaped differently from every other one here
 *
 * Every other port in this directory names a fixed capability with a fixed row shape:
 * `AdminMembersPort` returns `AdminMember`, `AdminSeoPort` returns `AdminSeoMeta`. That works
 * because the capability is the same everywhere it is wired — a member is a member.
 *
 * An application's own entities are not like that. A recipe app has recipes and authors; a
 * warehouse app has pallets and SKUs. There is no fixed row shape to write down, and force-fitting
 * one onto an existing port is lossy in a way that shows up immediately: mapping an app's `Author`
 * onto `AdminMember` has to invent a `status`, and drops every field (`bio`) the app actually has.
 *
 * So this port carries its own schema. An adapter declares an {@link AdminEntityDescriptor}, and
 * the row type is *derived* from it ({@link AdminEntityRow}) rather than declared twice. A host
 * screen reads the descriptor to decide what to render, which is what makes one screen able to
 * render any entity with no per-entity code.
 *
 * ## What this port deliberately does NOT carry
 *
 * - **No `workspaceId`, and no other host-specific field.** If a field cannot be produced by an app
 *   with no database, it does not belong on a generic row. Multi-tenancy is the adapter's business,
 *   held in its own closure, invisible here. This is the single rule that keeps an adapter for a
 *   plain in-memory array as short as an adapter for a real backend.
 * - **No response envelope.** `list` returns {@link AdminEntityPage}, `get` returns the row itself
 *   — never `{ entity }` or `{ items }`-plus-metadata. {@link AdminEntityPage} is not a
 *   counterexample: `nextCursor` is pagination state that has nowhere else to live, not a wrapper
 *   around the payload.
 * - **No `expectedVersion` on `update`.** Every other write in this package carries one. It is
 *   omitted here because an in-memory store has no version column, and requiring one would make the
 *   smallest honest adapter impossible to write. An entity that wants optimistic concurrency
 *   declares a `version` field of kind `"integer"` and enforces it inside its own `update`. This is
 *   a real weakening relative to the other ports, stated rather than hidden, and worth revisiting
 *   the first time a genuinely multi-writer entity appears.
 * - **No publication lifecycle.** `AdminEntry`-style `draft`/`published` belongs to a CMS entry, not
 *   to an arbitrary entity. An app that wants one declares a `status` field of kind `"text"`.
 * - **No per-operation authorization seam** (no `canCreate`/`canDelete`). Consistent with every
 *   other port here, and with `AdminPanel.permissions` being affordance-only — but worth naming,
 *   because a generic CRUD surface over arbitrary application data is where that gap starts to
 *   matter more than it does on a fixed screen.
 *
 * Types only, like every file in this directory. The runtime half — registration, descriptor
 * validation, and the erasure a generic screen consumes — lives in `../entities/rules.ts`.
 */

/**
 * The closed set of field kinds an entity may declare.
 *
 * **Closed deliberately**, unlike the reference-implementation-derived unions elsewhere in this
 * directory (see `README.md`'s `T | (string & {})` idiom). A kind is not a label: each member here
 * is a promise that a rendering layer knows how to display and edit it, and that a persistence
 * layer knows its storage class. A host cannot add a seventh kind by widening a string — it would
 * render as nothing. Adding a kind is a change to this package.
 *
 * `"media"` and `"enum"` are deliberately absent. `"media"` is the same shape as `"relation"` at
 * rest (a foreign id stored as text) and differs only in needing a media *picker*, which needs
 * `AdminMediaPort` wired; adding it before that picker exists would ship a kind indistinguishable
 * from `"text"`. `"enum"` has a real unresolved question (does a queryable enum index the label or
 * the ordinal?) and no forcing case.
 */
export type AdminEntityFieldKind =
  | 'text'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'datetime'
  | 'relation'
  | 'json';

/** Fields common to every kind. `relation` adds `target`; `json` narrows `queryable`. */
interface AdminEntityFieldBase {
  /**
   * The key this field occupies on a row.
   *
   * **No identifier grammar is imposed here, and that is deliberate.** The identifier grammar that
   * gates a CMS content-type key (`^[a-z][a-z0-9_]{0,63}$`) is load-bearing where a field name
   * reaches SQL DDL — it does not reach it here. Applying it to this descriptor would reject
   * `authorId` and `createdAt`, i.e. would require an application to rename its own fields in order
   * to get an admin. An app that is *also* persisted through the CMS maps names in its adapter,
   * where the mapping is visible, rather than in its descriptor.
   *
   * `"id"` is reserved: every row already has one (see {@link AdminEntityRow}).
   */
  readonly name: string;
  /** Human-readable column/label text. Falls back to {@link AdminEntityFieldBase.name}. */
  readonly label?: string;
  /** When true, the row type makes this field non-optional — see {@link AdminEntityRow}. */
  readonly required?: boolean;
  /**
   * Whether a backend can filter or order on this field without a full scan.
   *
   * **Currently advisory in both directions, and nothing enforces either half.** A screen is
   * expected to offer filter/sort controls only for `queryable` fields, and an adapter is expected
   * to reject a filter on a non-queryable one rather than silently scanning — but this is a
   * type-only port, so both are obligations rather than guarantees. An in-memory adapter (every
   * app's first one) filters anything happily, so a filter that is a full scan in production looks
   * correct in development. Read this flag as documentation of intent, not as a capability.
   */
  readonly queryable?: boolean;
}

/** A value stored inline: text, a number, a flag, or an ISO-8601 timestamp. */
export type AdminEntityScalarField = AdminEntityFieldBase & {
  readonly kind: 'text' | 'integer' | 'real' | 'boolean' | 'datetime';
};

/** A foreign id pointing at another registered entity. */
export type AdminEntityRelationField = AdminEntityFieldBase & {
  readonly kind: 'relation';
  /**
   * The {@link AdminEntityDescriptor.name} this field points at. Checked against the registry at
   * composition time (`createAdminEntityRegistry`), not by the type system — a descriptor does not
   * know which other descriptors it will be registered beside.
   *
   * **No referential integrity is implied anywhere.** Nothing validates that the stored id names a
   * live row: not this port, not a rendering layer, not a persistence layer. A deleted target
   * leaves a dangling reference, and a screen's honest rendering of that is the raw id, visibly
   * marked as unresolved — not a blank cell.
   */
  readonly target: string;
};

/**
 * An arbitrary JSON value stored verbatim.
 *
 * Exists because no scalar kind can hold a list or a nested object, and an application's own
 * entities routinely have one (a recipe's ingredients). Storage-only: never indexed, never
 * filtered, never ordered — which is why `queryable` is typed `false | undefined` here, making
 * `queryable: true` on a json field a compile error rather than a runtime rejection.
 */
export type AdminEntityJsonField = Omit<AdminEntityFieldBase, 'queryable'> & {
  readonly kind: 'json';
  readonly queryable?: false;
};

/**
 * One declared field. A discriminated union rather than a flat interface with optional extras, so
 * `relation` can *require* its `target` instead of documenting that it needs one.
 */
export type AdminEntityField =
  | AdminEntityScalarField
  | AdminEntityRelationField
  | AdminEntityJsonField;

/** What an entity is: a name, labels, a title field, and its fields. */
export interface AdminEntityDescriptor {
  /**
   * Stable machine name — the URL segment a generic screen routes on, and the value a
   * {@link AdminEntityRelationField.target} names. Must equal the key this descriptor's port is
   * registered under (enforced by `createAdminEntityRegistry`), so there is exactly one name for
   * an entity rather than a registry key and a descriptor name that can drift apart.
   */
  readonly name: string;
  readonly labelSingular: string;
  readonly labelPlural: string;
  /**
   * Which field renders as a row's human-readable title — in lists, and in every relation picker
   * that points at this entity.
   *
   * **Cannot be constrained to "a `text` field on this same descriptor" by the type system** without
   * a conditional type heavy enough to make every descriptor's errors unreadable, so it is checked
   * at registration instead. A typo here is not a small bug: it makes every relation picker
   * pointing at this entity show `undefined` for every row.
   */
  readonly titleField: string;
  readonly fields: readonly AdminEntityField[];
}

/** The runtime type each kind's value takes on a row. */
interface AdminEntityKindValue {
  text: string;
  datetime: string;
  integer: number;
  real: number;
  boolean: boolean;
  /** A foreign id — same storage class as `text`. */
  relation: string;
  /** Storage-only, so nothing may consume it without narrowing first. */
  json: unknown;
}

type AdminEntityFieldValue<F extends AdminEntityField> = F extends {
  kind: infer K extends AdminEntityFieldKind;
}
  ? K extends keyof AdminEntityKindValue
    ? AdminEntityKindValue[K]
    : never
  : never;

type AdminEntityRequiredNames<F extends AdminEntityField> = F extends { required: true }
  ? F['name']
  : never;

/**
 * The row shape a descriptor describes — derived, never hand-written.
 *
 * Requires the descriptor to be declared `as const satisfies AdminEntityDescriptor`: without
 * `as const` the field names widen to `string` and every key collapses. Fields declared
 * `required: true` are non-optional; everything else is optional. `id` is always present and is
 * never a declared field.
 *
 * @example
 * const recipe = {
 *   name: 'recipe', labelSingular: 'Recipe', labelPlural: 'Recipes', titleField: 'title',
 *   fields: [
 *     { name: 'title', kind: 'text', required: true },
 *     { name: 'authorId', kind: 'relation', target: 'author', required: true },
 *     { name: 'ingredients', kind: 'json' },
 *   ],
 * } as const satisfies AdminEntityDescriptor;
 * // AdminEntityRow<typeof recipe> is
 * //   { id: string; title: string; authorId: string; ingredients?: unknown }
 */
export type AdminEntityRow<D extends AdminEntityDescriptor> = { readonly id: string } & {
  readonly [F in D['fields'][number] as F['name'] & AdminEntityRequiredNames<F>]: AdminEntityFieldValue<F>;
} & {
  readonly [F in D['fields'][number] as F['name'] &
    Exclude<F['name'], AdminEntityRequiredNames<F>>]?: AdminEntityFieldValue<F>;
};

/** One filter clause. `field` should name a `queryable` field — see that flag's own caveat. */
export interface AdminEntityFilter {
  readonly field: string;
  readonly op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
  readonly value: string | number | boolean;
}

export interface AdminEntityListQuery {
  /** Maximum rows in the returned page. An adapter may return fewer; it must not return more. */
  readonly limit?: number;
  /**
   * Opaque forward cursor, taken verbatim from a prior page's {@link AdminEntityPage.nextCursor}.
   *
   * **Not an offset.** An offset cannot be made stable under concurrent writes — a row inserted
   * before the current position shifts every later page by one, silently duplicating or skipping a
   * row. Every backend this port is likely to front can express keyset pagination over
   * `(sortField, id)` instead.
   *
   * **Forward-only, by decision rather than by accident.** There is no `prevCursor`, because a
   * backwards keyset walk needs a reversed comparator this port does not express. A screen that
   * wants a "Previous" control holds the cursors it has already visited itself; that history is
   * screen state and does not survive a reload.
   */
  readonly cursor?: string;
  readonly filter?: readonly AdminEntityFilter[];
  /**
   * Ordering, applied by the adapter over the whole collection *before* the page is cut.
   *
   * Ordering is a server concern and this is the only place it may be expressed. Sorting a page
   * after it has been cut reorders the rows on screen and nothing else — correct-looking at one
   * page, meaningless at two, and no value-comparison test detects the difference.
   */
  readonly sort?: { readonly field: string; readonly direction: 'asc' | 'desc' };
}

export interface AdminEntityPage<TRow> {
  readonly items: readonly TRow[];
  /**
   * Cursor for the next page, or `null` on the last one.
   *
   * Required rather than optional — matching `AdminFormSubmissionPage`, this package's other
   * cursor-paginated shape — because forgetting it silently caps every list at one page, which
   * looks entirely correct until a collection outgrows one. `null` is a decision an adapter has to
   * type out.
   */
  readonly nextCursor: string | null;
  /**
   * Total rows matching the query, when the adapter can count cheaply.
   *
   * Genuinely optional, unlike `nextCursor`: omitting it degrades one label, and forcing a count
   * query on every list read to satisfy the type would be worse than not having the label.
   */
  readonly total?: number;
}

/**
 * CRUD over one application-defined entity.
 *
 * `D` is the descriptor *value's* type (`typeof recipeDescriptor`), not `AdminEntityDescriptor` —
 * that is what lets `list`/`get`/`create` return rows typed from the declaration.
 *
 * Note that `AdminEntityPort<SomeSpecificDescriptor>` is **not** assignable to
 * `AdminEntityPort<AdminEntityDescriptor>`: `create`/`update` take the row type as a parameter and
 * are therefore contravariant in it. A screen generic over all entities consumes
 * {@link AdminErasedEntityPort} instead, reached through `eraseEntityPort`.
 */
export interface AdminEntityPort<D extends AdminEntityDescriptor> {
  readonly descriptor: D;
  list(query?: AdminEntityListQuery): Promise<AdminEntityPage<AdminEntityRow<D>>>;
  get(id: string): Promise<AdminEntityRow<D> | null>;
  create(input: Omit<AdminEntityRow<D>, 'id'>): Promise<AdminEntityRow<D>>;
  update(id: string, patch: Partial<Omit<AdminEntityRow<D>, 'id'>>): Promise<AdminEntityRow<D>>;
  /**
   * Optional. An entity that cannot be deleted omits it, and a generic screen renders no delete
   * affordance — the same "absence means the capability does not exist" convention
   * `AdminMembersPort` uses for its deliberately missing `enableMember`.
   */
  remove?(id: string): Promise<void>;
}

/** A row with its field types erased, as a screen generic over all entities sees it. */
export type AdminEntityRowData = Record<string, unknown> & { readonly id: string };

/**
 * {@link AdminEntityPort} with its descriptor generic erased — what a screen that renders *any*
 * entity actually holds. Produced only by `eraseEntityPort`; never implemented directly.
 */
export interface AdminErasedEntityPort {
  readonly descriptor: AdminEntityDescriptor;
  list(query?: AdminEntityListQuery): Promise<AdminEntityPage<AdminEntityRowData>>;
  get(id: string): Promise<AdminEntityRowData | null>;
  create(input: Record<string, unknown>): Promise<AdminEntityRowData>;
  update(id: string, patch: Record<string, unknown>): Promise<AdminEntityRowData>;
  remove?(id: string): Promise<void>;
}

/**
 * The assembled registry: entity name -> port, with each port's own type preserved.
 *
 * Same inference shape as `AdminClient` — a host's entities and any Jini-shipped ones would be
 * indistinguishable here, and registering one is a line in an object literal.
 */
export type AdminEntityRegistry<
  TPorts extends Record<string, AdminEntityPort<AdminEntityDescriptor>>,
> = {
  readonly [K in keyof TPorts]: TPorts[K];
};
