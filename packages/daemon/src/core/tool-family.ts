/**
 * What a host says about an id that names a group of tools rather than one tool. The host owns the
 * group (its ids and its selector keys are product vocabulary); the daemon owns only the rule that
 * nothing the host names is shown unless the run's own registry holds it.
 */
import type { ToolRegistry } from '@jini-ai/core';

/** Selector keys an input may carry, and which member each value picks. Advice for the caller; never a dispatch. */
export interface FamilySelector {
  readonly keys: readonly string[];
  readonly byValue: Readonly<Record<string, string>>;
}

/** What a host's {@link ToolFamilyPort} returns for a group id. */
export interface ToolFamilyDescription {
  readonly members: readonly string[];
  readonly selector?: FamilySelector;
}

/** Host-owned lookup of tool groups. An id the host does not know is `undefined`; omitting the port means "no groups". */
export interface ToolFamilyPort {
  describeFamily(required: { familyId: string }): ToolFamilyDescription | undefined;
}

/** A group as the route may show it: members and selector already filtered by the run's registry. */
export interface ToolFamily {
  readonly id: string;
  readonly members: readonly string[];
  readonly selector?: FamilySelector;
}

/** Bounds that keep a host's answer from growing the reply without limit. */
const MAX_FAMILY_ENTRIES = 64;
const MAX_SELECTOR_KEY_LENGTH = 64;

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SELECTOR_KEY_LENGTH;
}

/** @returns The selector with only own string keys of at most 64 characters that point at a visible member; undefined when nothing is left. */
function visibleSelector(
  { selector, members }: { readonly selector: FamilySelector | undefined; readonly members: readonly string[] },
  _optional: Record<string, never> = {},
): FamilySelector | undefined {
  if (selector === undefined) return undefined;
  const visible = new Set(members);
  const keys = selector.keys.filter(isShortString).slice(0, MAX_FAMILY_ENTRIES);
  const entries = Object.entries(selector.byValue)
    .filter(([value, member]) => isShortString(value) && typeof member === 'string' && visible.has(member))
    .slice(0, MAX_FAMILY_ENTRIES);
  return keys.length === 0 || entries.length === 0 ? undefined : { keys, byValue: Object.fromEntries(entries) };
}

/**
 * Filters a host's group description by the ids the run's registry holds. The host is never trusted for
 * visibility: a member it names that this registry does not hold is absent from the members and from the
 * selector, so a group answer cannot reveal a tool the run cannot see.
 *
 * @param required.familyId - The group id the request named.
 * @param required.description - What the host said about it.
 * @param required.visibleIds - The ids the run's own registry lists.
 * @returns The visible group, or `undefined` when no member is visible (then the id is just unknown).
 * @complexity O(m + s) for m members and s selector entries, both read up to 64 after filtering.
 */
export function visibleToolFamily(
  { familyId, description, visibleIds }: { readonly familyId: string; readonly description: ToolFamilyDescription; readonly visibleIds: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): ToolFamily | undefined {
  const members = description.members.filter((member) => visibleIds.has(member)).slice(0, MAX_FAMILY_ENTRIES);
  if (members.length === 0) return undefined;
  const selector = visibleSelector({ selector: description.selector, members });
  return { id: familyId, members, ...(selector === undefined ? {} : { selector }) };
}

/**
 * The member a request's input points at through the group's selector, for ranking suggestions only.
 *
 * @returns The member id, or `undefined` when the input carries no selector value the group knows.
 * @complexity O(k) for k selector keys.
 */
export function selectedFamilyMember(
  { family, input }: { readonly family: ToolFamily; readonly input: unknown },
  _optional: Record<string, never> = {},
): string | undefined {
  if (family.selector === undefined || typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const fields = input as Record<string, unknown>;
  const { keys, byValue } = family.selector;
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && Object.hasOwn(byValue, value)) return byValue[value];
  }
  return undefined;
}

/**
 * A host's group of `<familyId>.<name>` tools — a namespace of cards, never a tool of its own —
 * told to the delegated-tool route. When an agent calls the bare id, the route asks this port what
 * the id is and answers with the members instead of "no such tool". Only the names live here: the
 * route filters every member by the run's own registry before it shows anything, and nothing is
 * executed or rerouted, so the agent's next request names a concrete member and passes every host
 * gate under that id.
 *
 * Built from the registry the route serves, read at the moment a bare id arrives so a card
 * registered or retired since startup is reflected.
 *
 * @param required.registry - The run-scoped registry; only `list` is read.
 * @param required.familyId - The host's group id (product vocabulary, injected).
 * @param required.selectorKeys - The input fields agents have used to say which card they meant when they called the bare id.
 * @returns A port that knows `familyId` and nothing else; `undefined` for every other id and when no card is registered.
 * @complexity O(r) per bare-id request for r registered tools; no I/O.
 */
export function createPrefixToolFamilyPort(
  { registry, familyId, selectorKeys }: {
    readonly registry: Pick<ToolRegistry, 'list'>;
    readonly familyId: string;
    readonly selectorKeys: readonly string[];
  },
  _optional: Record<string, never> = {},
): ToolFamilyPort {
  const memberPrefix = `${familyId}.`;
  return {
    describeFamily({ familyId: requested }) {
      if (requested !== familyId) return undefined;
      const members = registry.list({}).map(({ id }) => id).filter((id) => id.startsWith(memberPrefix));
      if (members.length === 0) return undefined;
      const byValue = Object.fromEntries(members.map((id) => [id.slice(memberPrefix.length), id]));
      return { members, selector: { keys: [...selectorKeys], byValue } };
    },
  };
}
