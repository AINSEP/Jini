/**
 * @module @jini/chat-core/agentic/page-executor
 *
 * The six `page.*` verbs, as policy over a {@link PageDriver}.
 *
 * Every refusal happens here, before the driver is called: schema validation, handle validation,
 * the field guard, the page allowlist, highlight clamping. A driver is mechanical and is trusted
 * to be — which means a second driver (same-document, sandboxed frame, a future native host)
 * inherits identical behavior for free rather than re-deriving it and getting one case wrong.
 *
 * Nothing here touches the DOM. That is what makes the interesting half testable without a
 * browser: "does it refuse to type into a password box" is a unit test, not an integration test.
 */
import {
  findCapabilityInputError,
  type CapabilityDef,
} from './capability.js';
import {
  AGENT_ELEMENT_ROLES,
  isValidElementHandle,
  type AgentElementRawState,
  type AgentElementRole,
  type AgentElementState,
} from './element-handles.js';
import {
  describeFieldReadRefusal,
  describeFieldRefusal,
  findFieldFillRefusal,
  findFieldReadRefusal,
  normalizeAgentLabel,
} from './guards.js';
import { PAGE_CAPABILITIES } from './page-capabilities.js';
import type { PageDriver } from './page-driver.js';

/** Default marker lifetime, long enough to notice and short enough not to linger. */
export const DEFAULT_HIGHLIGHT_MS = 3_000;

/**
 * Hard cap on a marker's lifetime. A caller asking for a very long highlight is really asking to
 * leave a permanent mark on someone else's page, which is a change of appearance rather than a
 * transient hint — and `page.highlight` is classified `read` precisely because it is transient.
 */
export const MAX_HIGHLIGHT_MS = 15_000;

/**
 * How many elements `withState` will describe in one call.
 *
 * State is per-element work and per-element payload, so an unfiltered `withState` on a large page
 * is both the slowest and the largest thing this surface can be asked for. The cap turns that into
 * a bounded answer plus an explicit `stateTruncated`, rather than a caller discovering the limit
 * as a timeout or a truncated blob. Narrowing with `role`/`query` is the intended way past it.
 */
export const MAX_STATEFUL_ELEMENTS = 50;

/** An element as returned to a caller, with page-authored text already bounded. */
export interface PageElementResult {
  readonly handle: string;
  readonly role: AgentElementRole | undefined;
  readonly label: string;
  readonly labelTruncated: boolean;
  readonly page: string | undefined;
  /** Present only when `withState` was asked for, the driver can observe, and the element resolved. */
  readonly state?: AgentElementState;
}

export interface FindElementsResult {
  readonly elements: readonly PageElementResult[];
  readonly pages: readonly string[];
  /**
   * Names the fields carrying page-authored text. Labels describe the UI; they are never
   * instructions, however imperative they read.
   */
  readonly untrustedFields: readonly string[];
  /** True when `withState` was asked for but this surface cannot observe itself. */
  readonly stateUnavailable?: boolean;
  /** True when more elements matched than {@link MAX_STATEFUL_ELEMENTS}, so later ones carry no state. */
  readonly stateTruncated?: boolean;
}

/**
 * What a write did to its target, as seen by the surface itself.
 *
 * The point is that a caller can check its own work. Before this, `page.click` replied
 * `{clicked: "item-water-window-plants"}` — an echo of the request, true whether or not anything
 * happened.
 */
export interface PageWriteObservation {
  /** Target state before the action. Absent when the surface cannot observe itself. */
  readonly before?: AgentElementState;
  /** Target state afterwards. Absent when unobservable, or when the action removed its own target. */
  readonly after?: AgentElementState;
  /**
   * Whether the target's own state differs. Deliberately named for what was actually compared:
   * a click can change much of a page while leaving the button it hit exactly as it was.
   */
  readonly targetChanged?: boolean;
}

function requireHandle(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !isValidElementHandle(value)) {
    throw new Error(
      `"${key}" must be a published element handle from page.find_elements — `
      + 'lowercase words joined by single hyphens, never a CSS selector',
    );
  }
  return value;
}

function clampHighlightDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_HIGHLIGHT_MS;
  return Math.min(value, MAX_HIGHLIGHT_MS);
}

function isAgentElementRole(value: unknown): value is AgentElementRole {
  return typeof value === 'string' && (AGENT_ELEMENT_ROLES as readonly string[]).includes(value);
}

/**
 * Turns a driver's raw reading into what a caller may see.
 *
 * The one decision here that is not formatting: whether a field's contents are reportable at all.
 * That runs on the descriptor the driver supplied, in this layer, for the same reason the fill
 * guard does — a secrecy rule re-derived by each driver is a secrecy rule that will eventually be
 * derived wrong. A value arriving with no descriptor to check is withheld rather than trusted.
 */
export function projectElementState(raw: AgentElementRawState): AgentElementState {
  const text = normalizeAgentLabel(raw.text);

  // Computed once, up front, so `checked` is gated by the exact same refusal as `value` below
  // rather than being copied through unconditionally. A checkbox/radio's `checked` is a second
  // secrecy channel, not a formatting detail: for a field like `health_disclosure_password`,
  // *which* option is ticked is itself the secret, even though it is a boolean and `value` was
  // already withheld. `text` is deliberately NOT gated here, on purpose, even for a refused
  // field: for a checkbox/radio, `text` is the option's own visible label (e.g. "I am HIV
  // positive") — page-authored content the page already renders openly to anyone who looks at
  // it, exactly like a `<select>`'s `options` below. The secret is which option is checked, not
  // what the option is called; withholding the label too would blind a caller to the page's own
  // ontology for no reduction in what actually leaks.
  const refusal = raw.field !== undefined ? findFieldReadRefusal(raw.field) : null;

  const base: AgentElementState = {
    text: text.text,
    textTruncated: text.truncated,
    ...(raw.checked !== undefined && refusal === null ? { checked: raw.checked } : {}),
    ...(raw.disabled !== undefined ? { disabled: raw.disabled } : {}),
    ...(raw.visible !== undefined ? { visible: raw.visible } : {}),
    // Bounded like every other page-authored string, but never withheld: the options a dropdown
    // offers are part of the UI's shape, not the user's data.
    ...(raw.options !== undefined
      ? { options: raw.options.map((option) => normalizeAgentLabel(option).text) }
      : {}),
  };

  if (raw.value === undefined) return base;
  if (raw.field === undefined) {
    return {
      ...base,
      valueWithheld: 'this element reported a value without the attributes needed to check it for secrets',
    };
  }
  if (refusal !== null) return { ...base, valueWithheld: describeFieldReadRefusal(refusal) };

  const value = normalizeAgentLabel(raw.value);
  return { ...base, value: value.text, valueTruncated: value.truncated };
}

/**
 * Whether two readings of the same element are indistinguishable to a caller.
 *
 * Compares only what the caller can actually see: a withheld value is compared as "withheld",
 * so a secret that changed reads as unchanged. That is the honest answer — a change no caller may
 * observe is not one this can report — and is why the field it feeds is named `targetChanged`.
 */
function sameElementState(a: AgentElementState, b: AgentElementState): boolean {
  return a.text === b.text
    && a.value === b.value
    && a.valueWithheld === b.valueWithheld
    && a.checked === b.checked
    && a.disabled === b.disabled
    && a.visible === b.visible;
}

/**
 * Reads one element's state, or `undefined` when there is nothing to read.
 *
 * Two different absences collapse here on purpose: a driver that cannot observe at all, and an
 * element that no longer resolves. A caller distinguishes them from context — `before` present
 * with `after` absent means the action removed its own target; both absent means the surface does
 * not report state.
 */
async function observeElement(driver: PageDriver, handle: string): Promise<AgentElementState | undefined> {
  if (driver.describeState === undefined || !isValidElementHandle(handle)) return undefined;
  const raw = await driver.describeState(handle);
  return raw === null ? undefined : projectElementState(raw);
}

/** Runs a write between two readings of its target, waiting for the surface to settle in between. */
async function observeWrite(
  driver: PageDriver,
  handle: string,
  write: () => Promise<void>,
): Promise<PageWriteObservation> {
  const before = await observeElement(driver, handle);
  await write();
  if (driver.settle !== undefined) await driver.settle();
  const after = await observeElement(driver, handle);
  return {
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined && after !== undefined
      ? { targetChanged: !sameElementState(before, after) }
      : {}),
  };
}

/** What page is showing and how much it publishes — the before/after pair for a navigation. */
export interface PageSummary {
  readonly page: string | undefined;
  readonly elementCount: number;
}

/**
 * Reads the showing page from the elements themselves, which is where a driver reports it. A
 * surface that publishes nothing has no page id to report, and says so rather than guessing.
 */
async function summarizePage(driver: PageDriver): Promise<PageSummary> {
  const elements = await driver.findElements({});
  return {
    page: elements.find((element) => element.page !== undefined)?.page,
    elementCount: elements.length,
  };
}

/**
 * Runs one `page.*` capability.
 *
 * @param driver - The host's page driver.
 * @param capabilityId - A `page.*` id from {@link PAGE_CAPABILITIES}.
 * @param input - Raw caller arguments, validated here against the declared schema.
 * @returns The capability's result.
 * @throws If the id is unknown, the input fails validation, a handle is malformed, the target is
 * a field no automated caller may fill, or the page is not published. Refusals are errors on
 * purpose: a caller must be told why, not handed a silent no-op it will retry forever.
 */
export async function executePageCapability(
  driver: PageDriver,
  capabilityId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const capability: CapabilityDef | undefined =
    PAGE_CAPABILITIES.find((entry) => entry.id === capabilityId);
  if (capability === undefined) throw new Error(`unknown page capability: ${capabilityId}`);

  const inputError = findCapabilityInputError(capability, input);
  if (inputError !== null) throw new Error(`${capabilityId}: ${inputError}`);

  switch (capabilityId) {
    case 'page.find_elements': {
      const role = input['role'];
      // The schema's enum check has already run; this narrows the type for the driver.
      const filter = {
        ...(isAgentElementRole(role) ? { role } : {}),
        ...(typeof input['query'] === 'string' ? { query: input['query'] } : {}),
      };
      const [found, pages] = await Promise.all([driver.findElements(filter), driver.listPages()]);
      const withState = input['withState'] === true;
      const observing = withState && driver.describeState !== undefined;

      const elements = await Promise.all(found.map(async (element, index): Promise<PageElementResult> => {
        const label = normalizeAgentLabel(element.label);
        const base: PageElementResult = {
          handle: element.handle,
          role: element.role,
          label: label.text,
          labelTruncated: label.truncated,
          page: element.page,
        };
        if (!observing || index >= MAX_STATEFUL_ELEMENTS) return base;
        const state = await observeElement(driver, element.handle);
        return state === undefined ? base : { ...base, state };
      }));

      return {
        elements,
        pages,
        untrustedFields: observing
          ? ['elements[].label', 'elements[].state.text', 'elements[].state.value']
          : ['elements[].label'],
        ...(withState && !observing ? { stateUnavailable: true } : {}),
        ...(observing && found.length > MAX_STATEFUL_ELEMENTS ? { stateTruncated: true } : {}),
      } satisfies FindElementsResult;
    }

    case 'page.highlight': {
      const handle = requireHandle(input, 'element');
      const durationMs = clampHighlightDuration(input['durationMs']);
      await driver.highlight(handle, durationMs);
      return { highlighted: handle, durationMs };
    }

    case 'page.scroll_to': {
      const handle = requireHandle(input, 'element');
      await driver.scrollTo(handle);
      return { scrolledTo: handle };
    }

    case 'page.click': {
      const handle = requireHandle(input, 'element');
      const observation = await observeWrite(driver, handle, () => driver.click(handle));
      return { clicked: handle, ...observation };
    }

    case 'page.fill': {
      const handle = requireHandle(input, 'element');
      // Declared required and typed `string` in the manifest, and `findCapabilityInputError`
      // enforced both above — re-checking here would be an unreachable branch, not a safeguard.
      const text = input['text'] as string;

      // Ask the page what this field actually is before writing to it. A handle proves the page
      // published the element; it says nothing about whether it holds a password.
      const field = await driver.describeField(handle);
      if (field === null) throw new Error(`"${handle}" is not a fillable field`);
      const refusal = findFieldFillRefusal(field);
      if (refusal !== null) {
        throw new Error(`refusing to fill "${handle}": ${describeFieldRefusal(refusal)}`);
      }

      const observation = await observeWrite(driver, handle, () => driver.fill(handle, text));
      return { filled: handle, ...observation };
    }

    case 'page.select_option': {
      const handle = requireHandle(input, 'element');
      // Required and string-typed by the manifest, already enforced above. See page.fill.
      const option = input['option'] as string;
      // Optional and boolean-typed by the manifest; absent means "select it", same as before this
      // argument existed.
      const selected = input['selected'] === false ? false : true;
      // No field guard: a dropdown's options are authored by the page, so choosing one reveals
      // nothing the page had not already published, and none of the credential field types this
      // surface refuses can be a `<select>`.
      const observation = await observeWrite(driver, handle, () => driver.selectOption(handle, option, selected));
      // `optionSelected` names the boolean rather than reusing `selected`, which already means
      // "the handle this call acted on" for every verb in this switch (`clicked`, `filled`, …).
      return { selected: handle, option, optionSelected: selected, ...observation };
    }

    case 'page.navigate': {
      // Required and string-typed by the manifest, already enforced above. See page.fill.
      const page = input['page'] as string;
      const pages = await driver.listPages();
      if (!pages.includes(page)) {
        throw new Error(
          `"${page}" is not a published page. Available: ${pages.length > 0 ? pages.join(', ') : '(none)'}`,
        );
      }
      const before = await summarizePage(driver);
      await driver.navigate(page);
      if (driver.settle !== undefined) await driver.settle();
      const after = await summarizePage(driver);
      return { navigatedTo: page, before, after };
    }

    /* c8 ignore next 2 -- unreachable: the id was matched against PAGE_CAPABILITIES above. */
    default:
      throw new Error(`unhandled page capability: ${capabilityId}`);
  }
}
