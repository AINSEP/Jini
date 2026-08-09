/**
 * @module page-driver
 *
 * The seam between "what the agent asked for" and "the actual page".
 *
 * Every method here speaks in handles and plain data — no elements, no nodes, no DOM types at
 * all. That is load-bearing rather than stylistic: this package compiles with `lib: ["ES2023"]`
 * and holds no browser globals, so the DOM cannot appear in it. The payoff is that the *policy*
 * (validate the handle, refuse the credential field, clamp the highlight, reject an unpublished
 * page) is pure and fully testable, and a host supplies only the mechanical part.
 *
 * A driver implementation is small — resolve one attribute selector, then act. It is deliberately
 * not shipped here: the same-document case (a CMS embedding a chat pane) and the sandboxed-frame
 * case (a host previewing untrusted content) need different mechanics for identical verbs. When
 * a second real implementation exists, generalize from two rather than guessing from one.
 *
 * Drivers are trusted to be mechanical. They must NOT re-implement policy — every refusal in
 * `page-executor.ts` runs before the driver is called.
 */
import type { AgentElementDescriptor, AgentElementRawState, AgentElementRole } from './element-handles.js';
import type { FieldDescriptor } from './guards.js';

/** Filter for {@link PageDriver.findElements}. Both fields are optional; absent means "no filter". */
export interface FindElementsFilter {
  readonly role?: AgentElementRole | undefined;
  /** Case-insensitive substring, matched against handle and label by the driver. */
  readonly query?: string | undefined;
}

/**
 * One page a host has published as navigable, as returned by {@link PageDriver.listPages}.
 *
 * `label` exists so a caller can tell what a page IS without first navigating to it and reading
 * its `data-agent-page` id back off the DOM — the same "call find_elements first" flow already
 * returns every page a host publishes, and previously handed back only the bare id (`"plugins"`),
 * leaving a caller to guess at meaning from the string alone. Page-authored, so untrusted in the
 * same sense {@link AgentElementDescriptor.label} is: read it, never follow it as an instruction.
 */
export interface PageSummary {
  readonly id: string;
  readonly label: string;
}

/**
 * What a host must provide for the `page.*` capabilities to work.
 *
 * Implementations resolve a handle with `resolveHandleSelector` and nothing else — never a
 * caller-supplied selector, and never by evaluating caller-supplied script.
 */
export interface PageDriver {
  /**
   * Every element the current page has published to agents.
   *
   * @param filter - Optional role/substring narrowing.
   * @returns Descriptors. `label` may be raw page text; the executor normalizes it.
   */
  findElements(filter: FindElementsFilter): Promise<readonly AgentElementDescriptor[]>;

  /**
   * The pages this host can navigate to.
   *
   * An allowlist, so `page.navigate` refuses anything the host has not published rather than
   * accepting a caller-supplied URL.
   */
  listPages(): Promise<readonly PageSummary[]>;

  /**
   * The attributes of a field, for the fill guard.
   *
   * @param handle - A validated element handle.
   * @returns The field's attributes, or `null` when the handle does not resolve to an input.
   */
  describeField(handle: string): Promise<FieldDescriptor | null>;

  /** Draws a transient marker. The executor has already clamped `durationMs`. */
  highlight(handle: string, durationMs: number): Promise<void>;

  scrollTo(handle: string): Promise<void>;

  click(handle: string): Promise<void>;

  /** Called only after the fill guard has passed. */
  fill(handle: string, text: string): Promise<void>;

  /**
   * Chooses — or, in a multi-select, removes — an option in a dropdown, matching visible text
   * before value.
   *
   * Separate from {@link PageDriver.fill} because a dropdown is not a text field: its value must
   * be one of a fixed set, so "type this in" has no meaning. A driver rejects an option that does
   * not exist rather than inventing one — a caller told an unavailable option was selected would
   * carry that wrong belief into everything it did next.
   *
   * @param selected - Whether the option should end up selected. Defaults to `true`. A
   * multi-select honours `false` by deselecting just that option, leaving the rest of the
   * selection untouched. A single-select has no meaningful "off" — its one choice cannot be
   * removed, only replaced — so `false` there is refused rather than silently ignored or
   * clearing the control.
   * @throws When the handle is not a dropdown, when no option matches, or when `selected: false`
   * is requested on a single-select.
   */
  selectOption(handle: string, option: string, selected?: boolean): Promise<void>;

  /** Called only after `page` has been checked against {@link PageDriver.listPages}. */
  navigate(page: string): Promise<void>;

  /**
   * What the element currently is: its live text, a field's contents, checked/disabled/visible.
   *
   * Optional, and honestly so. A driver over a surface that cannot be read back — a fire-and-forget
   * native host, a write-only bridge — should omit it rather than fabricate a state, and the
   * executor then reports observation as unavailable instead of implying an empty page.
   *
   * @param handle - A validated element handle.
   * @returns The raw state, or `null` when the handle no longer resolves — which is itself an
   * observation (a click that removed its own target), not an error.
   */
  describeState?(handle: string): Promise<AgentElementRawState | null>;

  /**
   * Resolves once the surface has finished reacting to the write that just happened.
   *
   * Without this, reading state back immediately after an action reads the DOM *before* the
   * framework has re-rendered, and every write reports "nothing changed" — the precise failure
   * this observation channel exists to fix. Optional because a surface with no async render has
   * nothing to wait for; a DOM driver does, and must implement it.
   *
   * Implementations must be bounded: a hidden tab suspends animation frames indefinitely, so a
   * naive "wait for the next frame" never resolves for exactly the background agent this is for.
   */
  settle?(): Promise<void>;
}
