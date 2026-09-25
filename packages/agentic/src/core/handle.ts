/**
 * @module handle
 *
 * `agentHandle('save')` — the attribute props a component spreads onto its root element to
 * publish itself under this package's `data-agent-*` markup convention (see
 * `element-handles.ts`), without the caller having to know the attribute names or re-derive the
 * handle-validity rule itself.
 *
 * Deliberately pure data, no DOM: this returns a plain object of string attributes, spreadable by
 * React (`<button {...agentHandle('save')}>`), Vue, Svelte, or any renderer that accepts arbitrary
 * attribute props on an element. That is what lets it live in this package's universal root
 * rather than `./dom` — nothing here touches `document` or any browser global.
 */
import {
  AGENT_ELEMENT_ATTRIBUTE,
  AGENT_LABEL_ATTRIBUTE,
  AGENT_PAGE_ATTRIBUTE,
  AGENT_ROLE_ATTRIBUTE,
  isValidElementHandle,
  type AgentElementRole,
} from './element-handles.js';

/** Optional markup to attach alongside the handle itself. */
export interface AgentHandleOptions {
  /** What verb applies to this element — see {@link AgentElementRole}. */
  readonly role?: AgentElementRole;
  /** Stable, page-authored ontology for this element (e.g. `"Full name"`). Never live text. */
  readonly label?: string;
  /** Which published page this element belongs to, for a multi-page host. */
  readonly page?: string;
}

/** The attribute props {@link agentHandle} returns, ready to spread onto an element. */
export type AgentHandleProps = {
  readonly [AGENT_ELEMENT_ATTRIBUTE]: string;
} & Partial<
  Record<
    typeof AGENT_ROLE_ATTRIBUTE | typeof AGENT_LABEL_ATTRIBUTE | typeof AGENT_PAGE_ATTRIBUTE,
    string
  >
>;

/**
 * Builds the attribute props that publish `handle` as an agent-addressable element.
 *
 * @param handle - The handle to publish. Must satisfy {@link isValidElementHandle} — this
 *   function reuses that exact rule rather than a second, possibly-diverging check, since an
 *   adversarial probe already confirmed it rejects quotes, brackets, backslashes, unicode and
 *   overlong handles (see `element-handles.ts`).
 * @param options - Optional role/label/page markup.
 * @returns Attribute props to spread onto the element that should carry this handle.
 * @throws If `handle` is not a valid element handle — never publishes a handle a caller (`page.*`
 *   capabilities, `resolveHandleSelector`) could not later resolve.
 */
export function agentHandle(handle: string, options: AgentHandleOptions = {}): AgentHandleProps {
  if (!isValidElementHandle(handle)) {
    throw new Error(
      `invalid element handle "${handle.slice(0, 128)}": `
      + 'handles are lowercase words joined by single hyphens, and are never CSS selectors',
    );
  }
  const props: Record<string, string> = { [AGENT_ELEMENT_ATTRIBUTE]: handle };
  if (options.role !== undefined) props[AGENT_ROLE_ATTRIBUTE] = options.role;
  if (options.label !== undefined) props[AGENT_LABEL_ATTRIBUTE] = options.label;
  if (options.page !== undefined) props[AGENT_PAGE_ATTRIBUTE] = options.page;
  return props as AgentHandleProps;
}

/**
 * The handle for one sub-element published under `base` — `<base>-<action>`.
 *
 * The one join rule every multi-control component under a single host-supplied base handle needs
 * (a settings tab, a card, a form), extracted here so each such component imports it rather than
 * re-deriving the same template literal. First established as `sourceConfigActionHandle` in
 * `../../features/source-config-list/agent-handles.ts` before this package had a generic version —
 * that feature's own doc comment explains the naming split this generalizes ("a host names a
 * component; the component names its own parts").
 *
 * @param base - The component's own handle, as published by the host. Must already be a valid
 *   element handle — callers own that, same as every other `agentHandle()` base.
 * @param action - The sub-element's name. Always a literal chosen by the component, never host data.
 * @returns `<base>-<action>`.
 * @complexity O(1).
 */
export function agentSubHandle(base: string, action: string): string {
  return `${base}-${action}`;
}

/** What to publish about one sub-element — see {@link agentHandleProps}. */
export interface AgentHandlePropsOptions extends AgentHandleOptions {
  /**
   * The sub-element's name, appended to `base` via {@link agentSubHandle}. Omit when the element
   * IS `base` — the component's own root.
   */
  readonly action?: string;
}

/**
 * Builds the `data-agent-*` attribute props for one element of a component that takes a single
 * OPTIONAL base handle from its host, or nothing at all when the host published no base.
 *
 * This is the seam a component with more than one agent-addressable element should use: the host
 * hands the component ONE base handle (`agentHandle?: string` in that component's own props, named
 * identically to this function's own `handle.ts` sibling so a caller cannot mistake which handle a
 * component wants), and the component derives every sub-element's handle from it via `action`,
 * exactly the "host names a component, the component names its own parts" split
 * `source-config-list/agent-handles.ts` established first. Returning `{}` rather than throwing on
 * an `undefined` base is what keeps the host prop opt-in: a host that never passes `agentHandle`
 * renders exactly the markup it did before this existed — additive, never a behavior change.
 *
 * @param base - The component's own handle from the host, or `undefined` when it published none.
 * @param options - Role, stable label, optional page, and the optional `action` naming this
 *   sub-element (see {@link AgentHandlePropsOptions}).
 * @returns Spreadable attribute props, or `{}` when `base` is `undefined`.
 * @throws If `base` is defined but not a valid element handle — via `agentHandle()`, deliberately
 *   unguarded so a bad host-supplied base fails loudly at first render rather than silently
 *   answering to a handle the host never wrote.
 * @complexity O(1).
 */
export function agentHandleProps(
  base: string | undefined,
  options: AgentHandlePropsOptions = {},
): AgentHandleProps | Record<string, never> {
  if (base === undefined) return {};
  const { action, ...rest } = options;
  return agentHandle(action === undefined ? base : agentSubHandle(base, action), rest);
}
