import {
  AGENT_ELEMENT_ATTRIBUTE,
  AGENT_LABEL_ATTRIBUTE,
  AGENT_PAGE_ATTRIBUTE,
  AGENT_ROLE_ATTRIBUTE,
  AGENT_ELEMENT_ROLES,
  resolveHandleSelector,
  type AgentElementDescriptor,
  type AgentElementRole,
  type FieldDescriptor,
  type FindElementsFilter,
  type PageDriver,
} from '@jini/chat-core';

/**
 * A {@link PageDriver} over a real DOM subtree.
 *
 * Deliberately mechanical: every refusal — handle validation, the credential-field guard, the
 * page allowlist, highlight clamping — already ran in `executePageCapability` before anything
 * here is called. Re-checking would duplicate policy in a place that will drift from it.
 *
 * Scoped to a `root` the host names, never `document`. Scanning the whole document would make
 * any markup anywhere — including rendered user content — an authorization decision, which
 * inverts the point of an explicit allowlist.
 */

/** How the marker is drawn. Inline styles, so no stylesheet or CSP allowance is needed. */
const HIGHLIGHT_STYLE = {
  outline: '3px solid #e11d48',
  outlineOffset: '2px',
  borderRadius: '4px',
} as const;

function isAgentElementRole(value: string | null): value is AgentElementRole {
  return value !== null && (AGENT_ELEMENT_ROLES as readonly string[]).includes(value);
}

function describe(element: Element, page: string | undefined): AgentElementDescriptor {
  const role = element.getAttribute(AGENT_ROLE_ATTRIBUTE);
  const label = element.getAttribute(AGENT_LABEL_ATTRIBUTE) ?? element.textContent ?? '';
  return {
    handle: element.getAttribute(AGENT_ELEMENT_ATTRIBUTE) ?? '',
    role: isAgentElementRole(role) ? role : undefined,
    // The executor normalizes and bounds this; raw here on purpose so the guard is applied in
    // exactly one place rather than half-applied in two.
    label,
    labelTruncated: false,
    page,
  };
}

export interface DomPageDriverOptions {
  /** The subtree to expose. Never pass `document`. */
  readonly root: ParentNode & { querySelector: Element['querySelector'] };
  /** Page ids this driver may navigate to, and how to get there. */
  readonly pages: Readonly<Record<string, () => void>>;
  /**
   * The id of the page currently shown, reported on every element.
   *
   * Omit it in a single-page app that swaps views: the driver then reads `data-agent-page` from
   * the live DOM on every call, so navigating actually changes what elements report. A value
   * captured here is fixed for the driver's whole lifetime, which is right only for a surface that
   * never changes view — and silently wrong for one that does, since the driver outlives any one
   * view (it is bound to the connection, not the render).
   */
  readonly currentPage?: string | undefined;
}

/**
 * Builds a driver over `root`.
 *
 * @param options - The subtree, the navigable pages, and the current page id.
 * @returns A driver ready to hand to `executePageCapability`.
 */
export function createDomPageDriver(options: DomPageDriverOptions): PageDriver {
  const { root, pages } = options;
  /** Static when the host pinned one, otherwise read live so a view swap is reflected. */
  const resolvePage = (): string | undefined => options.currentPage ?? currentAgentPage(root);
  /** Timers keyed by handle, so re-highlighting the same element restarts rather than stacks. */
  const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const find = (handle: string): Element => {
    const element = root.querySelector(resolveHandleSelector(handle));
    if (element === null) throw new Error(`no element published as "${handle}" on this page`);
    return element;
  };

  /** The control a handle addresses — for a wrapper like `<li><label><input>`, the input. */
  const controlOf = (element: Element): Element =>
    element.matches('input, textarea, select, button, a')
      ? element
      : element.querySelector('input, textarea, select, button, a') ?? element;

  return {
    async findElements(filter: FindElementsFilter) {
      const page = resolvePage();
      const found = Array.from(root.querySelectorAll(`[${AGENT_ELEMENT_ATTRIBUTE}]`))
        .map((element) => describe(element, page))
        .filter((element) => element.handle.length > 0);
      const query = filter.query?.toLowerCase();
      return found.filter((element) => {
        if (filter.role !== undefined && element.role !== filter.role) return false;
        if (query === undefined) return true;
        return element.handle.toLowerCase().includes(query)
          || element.label.toLowerCase().includes(query);
      });
    },

    async listPages() {
      return Object.keys(pages);
    },

    async describeField(handle) {
      const control = controlOf(find(handle));
      if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
        return null;
      }
      return {
        type: control instanceof HTMLInputElement ? control.type.toLowerCase() : 'textarea',
        autocomplete: control.getAttribute('autocomplete')?.toLowerCase() ?? undefined,
        name: control.name || undefined,
        id: control.id || undefined,
        readOnly: control.readOnly,
        disabled: control.disabled,
      } satisfies FieldDescriptor;
    },

    async highlight(handle, durationMs) {
      const element = find(handle);
      if (!(element instanceof HTMLElement)) return;
      const previous = highlightTimers.get(handle);
      if (previous !== undefined) clearTimeout(previous);

      const restore = {
        outline: element.style.outline,
        outlineOffset: element.style.outlineOffset,
        borderRadius: element.style.borderRadius,
      };
      Object.assign(element.style, HIGHLIGHT_STYLE);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      highlightTimers.set(handle, setTimeout(() => {
        // Restore what was there rather than clearing: the element may have had its own outline.
        Object.assign(element.style, restore);
        highlightTimers.delete(handle);
      }, durationMs));
    },

    async scrollTo(handle) {
      find(handle).scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    async click(handle) {
      const control = controlOf(find(handle));
      if (!(control instanceof HTMLElement)) throw new Error(`"${handle}" is not clickable`);
      control.click();
    },

    async fill(handle, text) {
      const control = controlOf(find(handle));
      if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) {
        throw new Error(`"${handle}" is not a fillable field`);
      }
      // Assign through the prototype setter, then dispatch: React tracks the previous value on
      // the node and ignores an input event whose value it believes it already has, so a plain
      // `control.value = text` updates the DOM but leaves React state stale.
      const prototype = control instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(control, text);
      else control.value = text;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    },

    async navigate(page) {
      const go = pages[page];
      // The executor already checked the allowlist; this is the belt on the braces.
      if (go === undefined) throw new Error(`"${page}" is not a published page`);
      go();
    },
  };
}

/** Reads the current page's `data-agent-page`, for hosts that tag the body. */
export function currentAgentPage(root: ParentNode): string | undefined {
  const tagged = root.querySelector(`[${AGENT_PAGE_ATTRIBUTE}]`);
  return tagged?.getAttribute(AGENT_PAGE_ATTRIBUTE) ?? undefined;
}
