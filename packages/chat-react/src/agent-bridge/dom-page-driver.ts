import {
  AGENT_ELEMENT_ATTRIBUTE,
  AGENT_LABEL_ATTRIBUTE,
  AGENT_PAGE_ATTRIBUTE,
  AGENT_ROLE_ATTRIBUTE,
  AGENT_ELEMENT_ROLES,
  resolveHandleSelector,
  type AgentElementDescriptor,
  type AgentElementRawState,
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

/**
 * Upper bound on {@link createDomPageDriver}'s `settle`.
 *
 * A hidden tab stops delivering animation frames, so waiting for one never returns — and a
 * background tab is exactly where an agent-driven page ends up while the user works elsewhere.
 * This is the ceiling that keeps every write bounded regardless.
 */
const SETTLE_TIMEOUT_MS = 120;

function isAgentElementRole(value: string | null): value is AgentElementRole {
  return value !== null && (AGENT_ELEMENT_ROLES as readonly string[]).includes(value);
}

/**
 * Whether the element is a rich-text surface — a `contenteditable` region rather than a form
 * control. Rich-text editors are built this way, so treating one as unfillable makes every
 * comment box, description field and document editor unreachable.
 */
function isEditableRegion(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  // A control embedded in a rich-text document is still that control. Without this, a real
  // browser — which, unlike jsdom, propagates `isContentEditable` to every descendant — reports
  // the Save button inside an editor as a fillable text region, and `fill` overwrites its label
  // instead of refusing. The type-based refusals in `findFieldFillRefusal` cannot catch that
  // either, because the descriptor would say `contenteditable` rather than `button`.
  if (element.matches('input, textarea, select, button, a[href], summary, option')) return false;
  // The attribute is checked before `isContentEditable` because a headless DOM does not compute
  // the latter — relying on it alone makes every one of these tests pass vacuously while the real
  // browser behaves differently. `contenteditable=""` and `"plaintext-only"` are both editable;
  // only an explicit `"false"` is not.
  const attribute = element.getAttribute('contenteditable');
  if (attribute !== null) return attribute !== 'false';
  // Editability inherited from an ancestor, which only a real layout engine can tell us about.
  return element.isContentEditable === true;
}

/** The field attributes the guards need, or `null` when the control is not a text-bearing input. */
function fieldDescriptorOf(control: Element): FieldDescriptor | null {
  if (isEditableRegion(control)) {
    // Reported as a field so the same guards run: a contenteditable div named `card-number` is
    // no more fillable than an input would be. `type` is not a real HTML input type, and is not
    // in any denied set, which is correct — the guard should judge it by name and attributes.
    return {
      type: 'contenteditable',
      // Read for the same reason `name` is: neither attribute is standard on a div, but a page
      // that bothers to set one is telling the guard what the field holds, and honouring `name`
      // while ignoring `autocomplete` would refuse `name="card_number"` and accept the
      // `autocomplete="cc-number"` spelling of the same field.
      autocomplete: control.getAttribute('autocomplete')?.toLowerCase() || undefined,
      name: control.getAttribute('name') || undefined,
      id: control.id || undefined,
      readOnly: control.getAttribute('aria-readonly') === 'true',
      disabled: control.getAttribute('aria-disabled') === 'true',
    } satisfies FieldDescriptor;
  }
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
}

/**
 * Whether the element is actually rendered, or `undefined` when the platform cannot say.
 *
 * `checkVisibility` is the only answer that accounts for `display:none` on an ancestor, `hidden`,
 * `content-visibility` and an empty box at once. Where it is missing, this reports nothing rather
 * than falling back to a layout measurement — a headless DOM has no layout, so that fallback would
 * confidently declare every element invisible.
 */
function visibilityOf(element: Element): boolean | undefined {
  const check = (element as { checkVisibility?: () => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(element) : undefined;
}

/** `disabled` for the controls that have one; `undefined` for everything else, which is not the same as `false`. */
function disabledOf(control: Element): boolean | undefined {
  return control instanceof HTMLInputElement
    || control instanceof HTMLTextAreaElement
    || control instanceof HTMLButtonElement
    || control instanceof HTMLSelectElement
    ? control.disabled
    : undefined;
}

function describe(element: Element, page: string | undefined): AgentElementDescriptor {
  const role = element.getAttribute(AGENT_ROLE_ATTRIBUTE);
  /* c8 ignore next -- `Node.textContent` is typed nullable for the abstract node; on an Element it is always a string, so the `?? ''` satisfies the type and is not a reachable path. */
  const text = element.textContent ?? '';
  const label = element.getAttribute(AGENT_LABEL_ATTRIBUTE) ?? text;
  /* c8 ignore next -- only ever called on a `[data-agent-element]` match, so the attribute is present by construction. */
  const handle = element.getAttribute(AGENT_ELEMENT_ATTRIBUTE) ?? '';
  return {
    handle,
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
  /**
   * Active markers keyed by handle, so re-highlighting the same element restarts rather than
   * stacks — and carrying the styling to put back, which must be captured once, on the first
   * highlight. Re-reading the element on a restart would snapshot the marker itself, and the
   * element would keep it forever: a capability classified `read` precisely because it is
   * transient would permanently change how someone's page looks.
   */
  const highlights = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    restore: { outline: string; outlineOffset: string; borderRadius: string };
  }>();

  const find = (handle: string): Element => {
    const element = root.querySelector(resolveHandleSelector(handle));
    if (element === null) throw new Error(`no element published as "${handle}" on this page`);
    return element;
  };

  /**
   * The control a handle addresses — for a wrapper like `<li><label><input>`, the input.
   *
   * `<details>` is called out because its interactive part is the `<summary>`: clicking the
   * `<details>` element itself dispatches an event the platform ignores, so a disclosure widget
   * would never open and the caller would be told the click landed.
   */
  const controlOf = (element: Element): Element => {
    // An editable region IS the control. Descending would find a link inside a rich-text document
    // and address that instead of the text the caller meant to write.
    if (isEditableRegion(element)) return element;
    // `:scope >` because only a *direct child* `<summary>` is the disclosure control. An
    // unscoped query returns the first summary anywhere in the subtree, so a `<details>`
    // containing another one would toggle the inner disclosure while reporting that the outer
    // handle was clicked — the false success this whole suite exists to catch.
    if (element instanceof HTMLDetailsElement) {
      return element.querySelector(':scope > summary') ?? element;
    }
    return element.matches('input, textarea, select, button, a')
      ? element
      : element.querySelector('input, textarea, select, button, a, summary') ?? element;
  };

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
      return fieldDescriptorOf(controlOf(find(handle)));
    },

    async describeState(handle) {
      // Unlike every other method here, a handle that no longer resolves is an answer rather than
      // an error: an element that a click removed is exactly what the caller is asking about.
      const element = root.querySelector(resolveHandleSelector(handle));
      if (element === null) return null;
      const control = controlOf(element);
      const field = fieldDescriptorOf(control);
      const checkable = control instanceof HTMLInputElement
        && (control.type === 'checkbox' || control.type === 'radio');
      // A dropdown reports its option texts alongside its value. Without them a caller can only
      // guess what to pass to `page.select_option`, and a wrong guess is a refusal it could have
      // avoided by looking. It carries a descriptor too, so the read guard still runs — a
      // `<select name="secret_token">` is no more readable than an input of the same name.
      const dropdown = control instanceof HTMLSelectElement ? control : undefined;
      const readable = field ?? (dropdown === undefined ? null : {
        type: 'select',
        name: dropdown.name || undefined,
        id: dropdown.id || undefined,
        disabled: dropdown.disabled,
      } satisfies FieldDescriptor);
      const value = field !== null
        ? (control as HTMLInputElement | HTMLTextAreaElement).value
        : dropdown?.value;
      /* c8 ignore next -- as in `describe`: an Element's textContent is always a string. */
      const text = element.textContent ?? '';
      return {
        text,
        // Reported raw and unconditionally; `projectElementState` applies the read guard. A
        // driver deciding here which values are secret is a driver holding policy.
        ...(value !== undefined ? { value } : {}),
        ...(checkable ? { checked: (control as HTMLInputElement).checked } : {}),
        ...(disabledOf(control) !== undefined ? { disabled: disabledOf(control) } : {}),
        ...(visibilityOf(element) !== undefined ? { visible: visibilityOf(element) } : {}),
        ...(readable !== null ? { field: readable } : {}),
        ...(dropdown !== undefined
          ? {
              options: Array.from(dropdown.options)
                .map((entry) => entry.text.trim())
                .filter((entry) => entry.length > 0),
            }
          : {}),
      } satisfies AgentElementRawState;
    },

    /**
     * Two animation frames — long enough for a framework to have re-rendered and the browser to
     * have painted — or {@link SETTLE_TIMEOUT_MS}, whichever lands first. Without the timeout this
     * would hang for the whole life of a backgrounded tab; without the frames every write would
     * report its own target unchanged, because the read would beat the render.
     */
    async settle() {
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        // No re-entry guard: whichever side loses the race calls this again, and both of its
        // effects are already idempotent — clearing an elapsed timer is a no-op, and a second
        // `resolve` on a settled promise is ignored. A flag here would only be a branch nothing
        // can distinguish.
        const finish = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          resolve();
        };
        const raf = globalThis.requestAnimationFrame;
        // With no animation frames to wait for, one macrotask is the whole mechanism, and waiting
        // the full ceiling on every write would be pure latency.
        timer = setTimeout(finish, typeof raf === 'function' ? SETTLE_TIMEOUT_MS : 0);
        if (typeof raf === 'function') raf(() => raf(finish));
      });
    },

    async highlight(handle, durationMs) {
      const element = find(handle);
      if (!(element instanceof HTMLElement)) return;
      const active = highlights.get(handle);
      if (active !== undefined) clearTimeout(active.timer);

      // Reuse the first capture on a restart; see the map's own doc for what re-reading would cost.
      const restore = active?.restore ?? {
        outline: element.style.outline,
        outlineOffset: element.style.outlineOffset,
        borderRadius: element.style.borderRadius,
      };
      Object.assign(element.style, HIGHLIGHT_STYLE);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const timer = setTimeout(() => {
        // Restore what was there rather than clearing: the element may have had its own outline.
        Object.assign(element.style, restore);
        highlights.delete(handle);
      }, durationMs);
      highlights.set(handle, { timer, restore });
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
      if (isEditableRegion(control)) {
        // A contenteditable region has no `value`; its content *is* its children. `textContent`
        // replaces them wholesale, which is what "fill" means — and deliberately drops any markup
        // rather than injecting caller text as HTML.
        control.textContent = text;
        // Editors listen for `input`, not `change`; `change` is a form-control event and firing it
        // here would be inventing an event the platform never sends for this element.
        control.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
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

    async selectOption(handle, option) {
      const control = controlOf(find(handle));
      if (!(control instanceof HTMLSelectElement)) {
        throw new Error(`"${handle}" is not a dropdown`);
      }
      // Visible text first, then value: the text is what a caller saw in `find_elements`, and
      // matching value first would make an option whose value collides with another's label
      // resolve to the wrong entry.
      // A disabled option is not selectable by the user either, so offering it to an agent would
      // be a way around the page's own rule — and the resulting selection cannot be submitted.
      const options = Array.from(control.options).filter((entry) => !entry.disabled);
      const match = options.find((entry) => entry.text.trim() === option)
        ?? options.find((entry) => entry.value === option);
      if (match === undefined) {
        const available = options.map((entry) => entry.text.trim()).filter((text) => text.length > 0);
        throw new Error(
          `"${option}" is not an option of "${handle}". Available: ${available.length > 0 ? available.join(', ') : '(none)'}`,
        );
      }
      if (control.multiple) {
        // A multi-select accumulates. Assigning `value` would silently clear every prior choice,
        // so a caller building up a selection would end with only its last call's option.
        match.selected = true;
      } else {
        // Same prototype-setter dance as `fill`, for the same reason: React tracks the previous
        // value on the node and ignores a change event whose value it believes it already has.
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(control, match.value);
        else control.value = match.value;
      }
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
