// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isEscapeOwnedByInnerLayer, type InnerLayerQueryRoot } from "../escape-owned-by-inner-layer.js";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

/** A `querySelector` fake: answers from a fixed result, records what was asked, can throw once. */
function fakeRoot(opts: { found: boolean; throwFirst?: boolean }): InnerLayerQueryRoot & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    querySelector(selectors: string) {
      asked.push(selectors);
      if (opts.throwFirst && asked.length === 1) throw new SyntaxError("unsupported :modal");
      return opts.found ? {} : null;
    },
  };
}

const escape = { key: "Escape", defaultPrevented: false };

describe("isEscapeOwnedByInnerLayer", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("leaves Escape to an open modal or menu so the dock stays open", () => {
    const root = fakeRoot({ found: true });
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root })).toBe(true);
    expect(root.asked[0]).toContain('[aria-modal="true"]');
    expect(root.asked[0]).toContain('[role="menu"]');
  });

  it("lets the dock close on Escape when nothing is open", () => {
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root: fakeRoot({ found: false }) })).toBe(false);
  });

  it("treats an Escape an inner handler already prevented as owned, without querying the DOM", () => {
    const root = fakeRoot({ found: false });
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, key: "Escape", defaultPrevented: true, root })).toBe(true);
    expect(root.asked).toEqual([]);
  });

  it("ignores every other key without querying the DOM", () => {
    const root = fakeRoot({ found: true });
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, key: "Enter", defaultPrevented: true, root })).toBe(false);
    expect(root.asked).toEqual([]);
  });

  it("falls back to the ARIA check when the browser rejects :modal / :popover-open", () => {
    const root = fakeRoot({ found: true, throwFirst: true });
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root })).toBe(true);
    expect(root.asked[1]).not.toContain(":modal");
    expect(root.asked[1]).toContain('[aria-modal="true"]');
  });

  it("finds the real portaled modal in a DOM document", () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root: document })).toBe(true);
  });

  it("finds the open Chats menu (ConversationList's markup) in a DOM document", () => {
    document.body.innerHTML =
      '<div class="jini-conv"><button aria-haspopup="menu" aria-expanded="true"></button>'
      + '<div class="jini-conv-menu" role="menu"></div></div>';
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root: document })).toBe(true);
  });

  it("finds an expanded menu/listbox trigger even when its panel has another role", () => {
    document.body.innerHTML = '<button aria-haspopup="listbox" aria-expanded="true"></button>';
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root: document })).toBe(true);
  });

  it("does not count closed menus, mounted listboxes or an expanded dialog trigger (the FAB)", () => {
    document.body.innerHTML =
      '<button aria-haspopup="menu" aria-expanded="false"></button>'
      + '<ul role="listbox"></ul><div role="menu" hidden></div>'
      + '<button aria-haspopup="dialog" aria-expanded="true"></button>';
    expect(isEscapeOwnedByInnerLayer({ orFallbackSync, ...escape, root: document })).toBe(false);
  });

  it("dock rule end to end: menu open → Escape keeps the dock; nothing open → Escape closes it", () => {
    let dockOpen = true;
    const dockListener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isEscapeOwnedByInnerLayer({ orFallbackSync, key: e.key, defaultPrevented: e.defaultPrevented, root: document })) dockOpen = false;
    };
    document.addEventListener("keydown", dockListener);
    try {
      document.body.innerHTML = '<div role="menu"></div>';
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(dockOpen).toBe(true);

      document.body.innerHTML = "";
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(dockOpen).toBe(false);
    } finally {
      document.removeEventListener("keydown", dockListener);
    }
  });
});
