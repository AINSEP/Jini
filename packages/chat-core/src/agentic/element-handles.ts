/**
 * @module @jini/chat-core/agentic/element-handles
 *
 * The `data-agent-*` markup convention: how a page names the things an agent may act on.
 *
 * Handles are an **allowlist**, not a query language. A caller names a handle the page
 * already published; it never supplies a selector. That is the whole security property —
 * `resolveHandleSelector` can only ever build `[data-agent-element="<validated-handle>"]`,
 * so there is no path from caller input to an arbitrary `querySelector`.
 */

export const AGENT_ELEMENT_ATTRIBUTE = 'data-agent-element';
export const AGENT_ROLE_ATTRIBUTE = 'data-agent-role';
export const AGENT_LABEL_ATTRIBUTE = 'data-agent-label';
export const AGENT_PAGE_ATTRIBUTE = 'data-agent-page';

/** What verb applies to a tagged element. Mirrors the convention documented in the sample markup. */
export type AgentElementRole =
  | 'button'
  | 'checkbox'
  | 'field'
  | 'form'
  | 'list'
  | 'status'
  | 'region'
  | 'link';

export const AGENT_ELEMENT_ROLES: readonly AgentElementRole[] = [
  'button', 'checkbox', 'field', 'form', 'list', 'status', 'region', 'link',
];

/**
 * Lowercase, digits and single hyphens. Deliberately narrower than CSS allows: a handle that
 * cannot contain a quote, bracket, backslash or whitespace cannot break out of the attribute
 * selector it is interpolated into.
 */
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Upper bound on a handle, so a hostile page cannot publish a megabyte-long name. */
const MAX_HANDLE_LENGTH = 128;

/**
 * Whether `handle` is a syntactically valid agent element handle.
 *
 * @param handle - Candidate handle, typically caller-supplied.
 * @returns True when it is safe to interpolate into an attribute selector.
 */
export function isValidElementHandle(handle: string): boolean {
  return handle.length > 0 && handle.length <= MAX_HANDLE_LENGTH && HANDLE_PATTERN.test(handle);
}

/**
 * Builds the one selector shape this system will ever resolve.
 *
 * @param handle - A handle published by the page.
 * @returns The attribute selector for that handle.
 * @throws If the handle is not valid — never fall back to treating it as a raw selector.
 */
export function resolveHandleSelector(handle: string): string {
  if (!isValidElementHandle(handle)) {
    throw new Error(
      `invalid element handle "${handle.slice(0, MAX_HANDLE_LENGTH)}": `
      + 'handles are lowercase words joined by single hyphens, and are never CSS selectors',
    );
  }
  return `[${AGENT_ELEMENT_ATTRIBUTE}="${handle}"]`;
}

/** A tagged element as described back to a caller. `label` is page-authored, so it is untrusted. */
export interface AgentElementDescriptor {
  readonly handle: string;
  readonly role: AgentElementRole | undefined;
  readonly label: string;
  readonly labelTruncated: boolean;
  readonly page: string | undefined;
}
