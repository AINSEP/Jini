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
