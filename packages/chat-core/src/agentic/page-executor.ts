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
  type AgentElementRole,
} from './element-handles.js';
import { describeFieldRefusal, findFieldFillRefusal, normalizeAgentLabel } from './guards.js';
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

/** An element as returned to a caller, with page-authored text already bounded. */
export interface PageElementResult {
  readonly handle: string;
  readonly role: AgentElementRole | undefined;
  readonly label: string;
  readonly labelTruncated: boolean;
  readonly page: string | undefined;
}

export interface FindElementsResult {
  readonly elements: readonly PageElementResult[];
  readonly pages: readonly string[];
  /**
   * Names the fields carrying page-authored text. Labels describe the UI; they are never
   * instructions, however imperative they read.
   */
  readonly untrustedFields: readonly string[];
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
      return {
        elements: found.map((element) => {
          const label = normalizeAgentLabel(element.label);
          return {
            handle: element.handle,
            role: element.role,
            label: label.text,
            labelTruncated: label.truncated,
            page: element.page,
          };
        }),
        pages,
        untrustedFields: ['elements[].label'],
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
      await driver.click(handle);
      return { clicked: handle };
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

      await driver.fill(handle, text);
      return { filled: handle };
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
      await driver.navigate(page);
      return { navigatedTo: page };
    }

    /* c8 ignore next 2 -- unreachable: the id was matched against PAGE_CAPABILITIES above. */
    default:
      throw new Error(`unhandled page capability: ${capabilityId}`);
  }
}
