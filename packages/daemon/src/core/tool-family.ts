/**
 * What a host says about an id that names a group of tools rather than one tool. The host owns the
 * group (its ids and its selector keys are product vocabulary); the daemon owns only the rule that
 * nothing the host names is shown unless the run's own registry holds it.
 */

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
