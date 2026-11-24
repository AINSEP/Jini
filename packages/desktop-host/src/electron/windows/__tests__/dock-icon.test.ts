/**
 * @file `windows/dock-icon.ts`: the dock tile icon, with a fake `app.dock`.
 */
import { describe, expect, it } from "vitest";

import { applyDockIcon } from "../index.js";

describe("applyDockIcon", () => {
  it("sets nothing and reports nothing without a dock (Windows, Linux)", () => {
    const errors: unknown[] = [];
    applyDockIcon({ dock: undefined, iconPath: "/icon.png", reportFailure: ({ error }) => errors.push(error) });
    expect(errors).toEqual([]);
  });

  it("puts the injected icon on a dock", () => {
    const set: string[] = [];
    const errors: unknown[] = [];
    applyDockIcon({ dock: { setIcon: (p) => { set.push(p); } }, iconPath: "/brand/app-icon.png", reportFailure: ({ error }) => errors.push(error) });
    expect(set).toEqual(["/brand/app-icon.png"]);
    expect(errors).toEqual([]);
  });

  it("hands an unreadable icon's raw error to the host and lets the boot carry on", () => {
    const thrown = new Error("Failed to load image");
    const errors: unknown[] = [];
    expect(() => applyDockIcon({
      dock: { setIcon: () => { throw thrown; } },
      iconPath: "/missing.png",
      reportFailure: ({ error }) => errors.push(error),
    })).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(thrown);
  });

  it("hands a non-Error throw to the host as-is rather than losing it", () => {
    const errors: unknown[] = [];
    applyDockIcon({ dock: { setIcon: () => { throw "bad image"; } }, iconPath: "/x.png", reportFailure: ({ error }) => errors.push(error) });
    expect(errors).toEqual(["bad image"]);
  });
});
