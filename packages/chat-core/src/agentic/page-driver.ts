/**
 * @module @jini/chat-core/agentic/page-driver
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
import type { AgentElementDescriptor, AgentElementRole } from './element-handles.js';
import type { FieldDescriptor } from './guards.js';

/** Filter for {@link PageDriver.findElements}. Both fields are optional; absent means "no filter". */
export interface FindElementsFilter {
  readonly role?: AgentElementRole | undefined;
  /** Case-insensitive substring, matched against handle and label by the driver. */
  readonly query?: string | undefined;
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
   * The `data-agent-page` ids this host can navigate to.
   *
   * An allowlist, so `page.navigate` refuses anything the host has not published rather than
   * accepting a caller-supplied URL.
   */
  listPages(): Promise<readonly string[]>;

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

  /** Called only after `page` has been checked against {@link PageDriver.listPages}. */
  navigate(page: string): Promise<void>;
}
