/**
 * @module element-handles
 *
 * The `data-agent-*` markup convention: how a page names the things an agent may act on.
 *
 * Handles are an **allowlist**, not a query language. A caller names a handle the page
 * already published; it never supplies a selector. That is the whole security property —
 * `resolveHandleSelector` can only ever build `[data-agent-element="<validated-handle>"]`,
 * so there is no path from caller input to an arbitrary `querySelector`.
 */
import type { FieldDescriptor } from './guards.js';

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

/**
 * What an element currently *is*, as opposed to what it is *for*.
 *
 * `label` answers "what is this control" and is stable page ontology — it stays `"Full name"`
 * whether the box is empty or holds `"Ada Lovelace"`. That stability is the reason a caller can
 * address the same element across a whole session, and the reason a driver must never overwrite a
 * label with live text. But it leaves a caller unable to check its own work: after typing a name,
 * after ticking a box, after navigating, the reply named the element and said nothing about
 * whether anything had actually happened.
 *
 * This is the missing half — a separate channel, so observation is added rather than ontology
 * traded away.
 *
 * `text` and any `value` are page-authored and therefore untrusted, exactly like `label`.
 */
export interface AgentElementState {
  /**
   * Live text rendered inside the element, normalized and bounded. Empty for a bare input, and
   * empty when withheld — see {@link AgentElementState.textWithheld}.
   */
  readonly text: string;
  readonly textTruncated: boolean;
  /**
   * Why `text` is empty on an element that has some — so a caller reads "withheld", not "blank".
   *
   * Only ever set for an editable region (a `contenteditable`), whose text is the field's own
   * contents rather than page-authored chrome. Every other element's text is what the page already
   * renders openly to anyone looking at it.
   */
  readonly textWithheld?: string;
  /** The field's current contents. Absent when the element is not a field, or when withheld. */
  readonly value?: string;
  readonly valueTruncated?: boolean;
  /** Why `value` is absent on a field that has one — so a caller reads "withheld", not "empty". */
  readonly valueWithheld?: string;
  /** Checkbox/radio state. Absent when the element is neither. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** False when the element is present in the DOM but not rendered. */
  readonly visible?: boolean;
  /**
   * A dropdown's available option texts — what `page.select_option` will accept. Absent for
   * everything else. Reported even when the current `value` is withheld: which options exist is
   * page-authored ontology, not the user's data.
   */
  readonly options?: readonly string[];
}

/**
 * What a driver reports for one element, before policy runs.
 *
 * Drivers stay mechanical: this carries the raw `value` and the `field` descriptor, and the
 * executor decides whether the value may be reported at all (see `findFieldReadRefusal`). Putting
 * that decision in the driver would place a secrecy rule in the one layer this design says must
 * not hold policy — and would have to be re-derived correctly by every future driver.
 */
export interface AgentElementRawState {
  /** Raw text content. The executor normalizes and bounds it. */
  readonly text: string;
  /**
   * True when this element's `text` IS the field's contents rather than page-authored chrome —
   * i.e. it is an editable region (`contenteditable`), which has no `value` of its own.
   *
   * A mechanical fact about the element, which is why a driver reports it: only the driver can
   * tell. What follows from it is policy and stays in `projectElementState`, which gates such text
   * with the same read guard it applies to `value`. Without this, a `<div contenteditable
   * name="password">` had no `value` to withhold and handed the secret back as `text` instead.
   */
  readonly textIsValue?: boolean | undefined;
  /** Raw field contents, reported unconditionally; the executor applies the read guard. */
  readonly value?: string | undefined;
  readonly checked?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly visible?: boolean | undefined;
  /** Present when the element resolves to a field, so the executor can apply the read guard. */
  readonly field?: FieldDescriptor | undefined;
  /** A dropdown's option texts. Page-authored, so it is bounded but never withheld. */
  readonly options?: readonly string[] | undefined;
}
