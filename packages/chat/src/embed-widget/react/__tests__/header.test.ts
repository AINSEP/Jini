import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { EmbedChatHeader } from '../header.js';
const headerCopy = { eyebrow: 'Workspace chat', newThread: 'New thread', cancel: 'Cancel', discard: 'Discard chat?' };
const keyboard = { subscribe: ({ onEscape }: { onEscape: () => void }) => {
  const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onEscape(); };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
} };

/**
 * Real `react-dom/client` render into a real JSDOM document, driven with genuine DOM events
 * (`.click()`, a real `KeyboardEvent` dispatched on `window`) rather than simulated handler calls —
 * this is a real component (confirm/cancel/Escape state machine, a real `useEffect` with a real
 * cleanup path), not a pure function, so the React Component Testing Policy's render/interaction/a11y
 * coverage applies. `.test.ts`, not `.test.tsx`: the repo's test globs (`package.json`) only match
 * `*.test.ts`, so this file uses `React.createElement` instead of JSX to stay picked up without a
 * glob change.
 *
 * No `@testing-library/react` in this app (see `package.json`) — "no new deps" per the coverage
 * brief — so DOM globals (`window`/`document`/etc.) are installed from a fresh `JSDOM` instance per
 * test and saved/restored, matching `remixicon-override.test.ts`'s pattern. `navigator` is
 * deliberately excluded: Node ≥21 defines a getter-only global `navigator` that a plain assignment
 * throws against, and nothing under test reads it.
 */

const DOM_GLOBAL_KEYS = [
  "window",
  "document",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
] as const;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installDom(): { dom: JSDOM; restore: () => void } {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of DOM_GLOBAL_KEYS) {
    saved[key] = g[key];
    g[key] = w[key];
  }
  return {
    dom,
    restore: () => {
      for (const key of DOM_GLOBAL_KEYS) g[key] = saved[key];
      dom.window.close();
    },
  };
}

describe("SiteAssistantHeader", () => {
  let dom: JSDOM;
  let restoreDom: () => void;
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    const installed = installDom();
    dom = installed.dom;
    restoreDom = installed.restore;
    container = dom.window.document.getElementById("root") as unknown as HTMLElement;
    root = createRoot(container as unknown as Element);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    restoreDom();
    vi.restoreAllMocks();
  });

  function renderHeader(props: { title: string; hasMessages: boolean; onReset: () => void }) {
    act(() => {
      root.render(React.createElement(EmbedChatHeader, { ...props, copy: headerCopy, keyboard }));
    });
  }

  function clickButton(text: string): void {
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
    assert.ok(button, `expected a button labeled "${text}"`);
    act(() => {
      (button as HTMLButtonElement).click();
    });
  }

  function pressEscape(): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  }

  it("renders the title, eyebrow, and a New thread button, with no confirm step", () => {
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => {} });

    assert.equal(container.querySelector(".jini-chat-pane__eyebrow")?.textContent, "Workspace chat");
    assert.equal(container.querySelector(".jini-chat-pane__title")?.textContent, "My Site");
    assert.equal(container.querySelectorAll("button").length, 1);
    assert.equal(container.querySelector("button")?.textContent, "New thread");
    assert.equal(container.querySelector(".jini-chat-embed__reset-confirm"), null);
  });

  it("resets immediately with no confirm step when the transcript is empty", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: false, onReset: () => (resetCount += 1) });

    clickButton("New thread");

    assert.equal(resetCount, 1);
    assert.equal(container.querySelector(".jini-chat-embed__reset-confirm"), null, "empty transcript has nothing to confirm");
  });

  it("shows a two-step confirm, without resetting yet, when the transcript has messages", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });

    clickButton("New thread");

    assert.equal(resetCount, 0, "must not reset until confirmed");
    assert.ok(container.querySelector(".jini-chat-embed__reset-confirm"));
    assert.ok(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Cancel"));
    assert.ok(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Discard chat?"));
  });

  it("autofocuses Cancel (the safe choice), not the destructive Discard button, once the confirm step appears", () => {
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => {} });
    clickButton("New thread");

    const cancelButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Cancel");
    assert.equal(dom.window.document.activeElement, cancelButton, "Cancel must hold focus, not Discard");
  });

  it("backs out on Cancel without resetting, restoring the plain New thread button", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });
    clickButton("New thread");

    clickButton("Cancel");

    assert.equal(resetCount, 0);
    assert.equal(container.querySelector(".jini-chat-embed__reset-confirm"), null);
    assert.equal(container.querySelector("button")?.textContent, "New thread");
  });

  it("resets and closes the confirm step when Discard is clicked", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });
    clickButton("New thread");

    clickButton("Discard chat?");

    assert.equal(resetCount, 1);
    assert.equal(container.querySelector(".jini-chat-embed__reset-confirm"), null);
  });

  it("backs out on Escape (from anywhere in the pane) without resetting", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });
    clickButton("New thread");
    assert.ok(container.querySelector(".jini-chat-embed__reset-confirm"), "sanity: confirm step is open");

    pressEscape();

    assert.equal(resetCount, 0);
    assert.equal(container.querySelector(".jini-chat-embed__reset-confirm"), null);
  });

  it("keeps confirmation open on non-Escape keydown without resetting", () => {
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });
    clickButton("New thread");
    const cancel = dom.window.document.activeElement!;
    assert.equal(cancel.textContent, "Cancel");

    for (const key of ["Tab", "Enter", "a"]) {
      act(() => {
        cancel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
      assert.ok(container.querySelector(".jini-chat-embed__reset-confirm"), `${key} must not dismiss confirmation on keydown`);
      assert.equal(resetCount, 0);
    }
  });

  it("Escape is inert when the confirm step is not open (no listener attached, nothing to dismiss)", () => {
    const added = vi.spyOn(window, "addEventListener");
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });

    assert.doesNotThrow(() => pressEscape());
    assert.equal(added.mock.calls.filter(args => args[0] === "keydown").length, 0);

    assert.equal(resetCount, 0);
    assert.equal(container.querySelector("button")?.textContent, "New thread");
  });

  it("removes its Escape listener on unmount — a later Escape after unmount touches nothing", async () => {
    // JSDOM lazily installs its own keydown observer on the first selector query (F7.2).
    // Initialize it before spying so these exact counts measure the component's listener.
    container.querySelector("button");
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    let resetCount = 0;
    renderHeader({ title: "My Site", hasMessages: true, onReset: () => (resetCount += 1) });
    clickButton("New thread");

    const keydownAdds = () => added.mock.calls.filter(args => args[0] === "keydown");
    const keydownRemoves = () => removed.mock.calls.filter(args => args[0] === "keydown");
    assert.equal(keydownAdds().length, 1);
    assert.equal(keydownRemoves().length, 0);
    clickButton("Cancel");
    assert.deepEqual(keydownRemoves().map((call) => call), keydownAdds().map((call) => call));
    clickButton("New thread");
    assert.equal(keydownAdds().length, 2);

    await act(async () => {
      root.unmount();
    });
    assert.deepEqual(keydownRemoves().map((call) => call), keydownAdds().map((call) => call));

    assert.doesNotThrow(() => pressEscape());
    assert.equal(resetCount, 0, "an unmounted component's onReset must never fire");
  });
});
